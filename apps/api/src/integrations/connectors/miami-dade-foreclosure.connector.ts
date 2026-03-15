import { parse } from "csv-parse/sync";
import {
  HealthStatus,
  IntegrationAccessMethod,
  IntegrationConnector,
  IntegrationStatus,
  SyncResult,
} from "./types";

const CLERK_OFFICIAL_RECORDS_URL = "https://www2.miamidadeclerk.gov/Developers/api/OfficialRecords";
const DISTRESS_DOC_KEYWORDS = ["LIS PENDENS", "FORECLOS"];

function parseCsv(text: string): Record<string, unknown>[] {
  if (!text.trim()) return [];
  return parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, unknown>[];
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown error";
}

function asRecord(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function readText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function normalizeFolio(value: string) {
  const digits = value.replace(/[^\d]/g, "");
  return digits || value.trim();
}

function isDistressDocType(value: string) {
  const normalized = value.toUpperCase();
  return DISTRESS_DOC_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function isSuccessfulStatus(statusText: string) {
  const normalized = statusText.trim().toUpperCase();
  if (!normalized) return false;
  return normalized === "SUCCESS" || normalized.startsWith("SUCCESS");
}

function extractOfficialRecords(payload: Record<string, unknown>) {
  const root = asRecord(payload.OfficialRecordList ?? payload.officialRecordList);

  if (Array.isArray(root.OfficialRecords)) return root.OfficialRecords;
  if (Array.isArray(root.officialRecords)) return root.officialRecords;
  if (root.OfficialRecords && typeof root.OfficialRecords === "object") return [root.OfficialRecords];
  if (root.officialRecords && typeof root.officialRecords === "object") return [root.officialRecords];

  return [];
}

type FolioLookupResult = {
  status: IntegrationStatus;
  message: string;
  records: Record<string, unknown>[];
  metrics: Record<string, unknown>;
};

export class MiamiDadeForeclosureConnector implements IntegrationConnector {
  source = "miami-dade-foreclosure";
  displayName = "Miami-Dade Foreclosure (Official)";
  category = "Distress / Foreclosure";
  accessMethod = IntegrationAccessMethod.API_REST;
  authType = "AuthKey";
  cadence = "Daily";
  requiredEnv = ["MIAMI_DADE_FORECLOSURE_API_KEY"];

  private endpoint() {
    return process.env.MIAMI_DADE_FORECLOSURE_URL?.trim() || CLERK_OFFICIAL_RECORDS_URL;
  }

  private authKey() {
    return process.env.MIAMI_DADE_FORECLOSURE_API_KEY?.trim() || "";
  }

  private headers() {
    const headers: Record<string, string> = {
      Accept: "application/json,text/csv;q=0.9,*/*;q=0.8",
    };

    // Support non-Clerk REST feeds that expect API key in header.
    const apiKey = this.authKey();
    if (apiKey) {
      headers["X-API-Key"] = apiKey;
    }
    return headers;
  }

  private withAuthKey(url: string, key: string) {
    if (!key) return url;
    try {
      const parsed = new URL(url);
      if (!parsed.searchParams.has("authKey") && !parsed.searchParams.has("AuthKey")) {
        parsed.searchParams.set("authKey", key);
      }
      return parsed.toString();
    } catch (_error) {
      const joiner = url.includes("?") ? "&" : "?";
      return `${url}${joiner}authKey=${encodeURIComponent(key)}`;
    }
  }

  private isOfficialRecordsEndpoint(url: string) {
    return /\/Developers\/api\/OfficialRecords/i.test(url);
  }

  private buildOfficialRecordsUrl(folio: string) {
    const base = this.endpoint();
    const key = this.authKey();
    const url = this.withAuthKey(base, key);
    const parsed = new URL(url);
    parsed.searchParams.set("parameter1", normalizeFolio(folio));
    parsed.searchParams.set("parameter2", "FN");
    return parsed.toString();
  }

  async lookupByFolio(folio: string): Promise<FolioLookupResult> {
    const key = this.authKey();
    if (!key) {
      return {
        status: IntegrationStatus.NEEDS_CONFIG,
        message: "MIAMI_DADE_FORECLOSURE_API_KEY is not configured",
        records: [],
        metrics: {},
      };
    }

    const endpoint = this.endpoint();
    const requestUrl = this.isOfficialRecordsEndpoint(endpoint)
      ? this.buildOfficialRecordsUrl(folio)
      : this.withAuthKey(endpoint, key);

    try {
      const response = await fetch(requestUrl, { headers: this.headers() });
      if (!response.ok) {
        return {
          status: IntegrationStatus.ERROR,
          message: `Foreclosure lookup failed: HTTP ${response.status}`,
          records: [],
          metrics: { folio: normalizeFolio(folio), httpStatus: response.status },
        };
      }

      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      if (contentType.includes("text/csv") || contentType.includes("application/csv")) {
        const rows = parseCsv(await response.text());
        return {
          status: IntegrationStatus.OK,
          message: "Foreclosure lookup completed",
          records: rows,
          metrics: { folio: normalizeFolio(folio), sampledRecords: rows.length, format: "csv" },
        };
      }

      const body = (await response.json()) as Record<string, unknown>;
      const statusText = readText(body, ["Status", "status"]);
      const statusDesc = readText(body, ["StatusDesc", "statusDesc"]);
      const ipAddress = readText(body, ["IPAddress", "ipAddress"]);
      const unitsBalance = body.UnitsBalance ?? body.unitsBalance ?? null;

      if (statusText && !isSuccessfulStatus(statusText)) {
        const normalizedDesc = statusDesc.toUpperCase();
        const status =
          normalizedDesc.includes("IP NOT AUTHORIZED") || normalizedDesc.includes("NOT AUTHORIZED")
            ? IntegrationStatus.NEEDS_CONFIG
            : IntegrationStatus.ERROR;
        return {
          status,
          message: statusDesc || `Foreclosure lookup failed (${statusText})`,
          records: [],
          metrics: { folio: normalizeFolio(folio), status: statusText, statusDesc, unitsBalance, ipAddress },
        };
      }

      const officialRecords = extractOfficialRecords(body).map((item) => asRecord(item));
      const distressRecords = officialRecords
        .map((record) => {
          const docType = readText(record, ["DOC_TYPE", "docType", "doctype"]);
          if (!docType || !isDistressDocType(docType)) return null;

          const observedAt = readText(record, ["REC_DATE", "DOC_DATE", "recDate", "docDate"]);
          const caseNumber = readText(record, ["CASE_NUM", "caseNumber"]);
          const folioNumber = normalizeFolio(readText(record, ["FOLIO_NUMBER", "folioNumber"]) || folio);
          const confidence = docType.toUpperCase().includes("FORECLOS") ? "HIGH" : "MEDIUM";

          return {
            parcelId: folioNumber,
            status: "CONFIRMED",
            confidence,
            observedAt: observedAt || null,
            docType,
            caseNumber: caseNumber || null,
            metadata: record,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      return {
        status: IntegrationStatus.OK,
        message: "Foreclosure lookup completed",
        records: distressRecords,
        metrics: {
          folio: normalizeFolio(folio),
          status: statusText || "SUCCESS",
          statusDesc,
          unitsBalance,
          ipAddress,
          officialRecords: officialRecords.length,
          distressRecords: distressRecords.length,
          format: "json",
        },
      };
    } catch (error) {
      return {
        status: IntegrationStatus.ERROR,
        message: `Foreclosure lookup failed: ${toErrorMessage(error)}`,
        records: [],
        metrics: { folio: normalizeFolio(folio) },
      };
    }
  }

  async sync(): Promise<SyncResult> {
    const key = this.authKey();
    if (!key) {
      return {
        status: IntegrationStatus.NEEDS_CONFIG,
        message: "MIAMI_DADE_FORECLOSURE_API_KEY is not configured",
      };
    }

    // Health/probe mode: caller can run folio batch sync via service.
    return {
      status: IntegrationStatus.OK,
      message: "Foreclosure connector configured. Run sync to validate lookup and ingest records.",
      metrics: { endpoint: this.endpoint() },
    };
  }

  async getHealthStatus(): Promise<HealthStatus> {
    if (!this.authKey()) {
      return {
        status: IntegrationStatus.NEEDS_CONFIG,
        message: "MIAMI_DADE_FORECLOSURE_API_KEY is not configured",
      };
    }
    return {
      status: IntegrationStatus.OK,
      message: "Foreclosure connector is configured. Execute sync to validate API authorization and ingest.",
    };
  }
}
