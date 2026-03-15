import { fetchArcgisSample } from "./arcgis";
import {
  HealthStatus,
  IntegrationAccessMethod,
  IntegrationConnector,
  IntegrationStatus,
  SyncResult,
} from "./types";

const FALLBACK_MIAMI_DADE_PARCELS_URL = "https://gisweb.miamidade.gov/arcgis/rest/services/MD_Emaps/MapServer/72";
const DEFAULT_MIAMI_DADE_WHERE = "OBJECTID IS NOT NULL";

function dedupe(values: string[]) {
  return [...new Set(values)];
}

function describeError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown error";
}

export class MiamiDadeParcelsConnector implements IntegrationConnector {
  source = "miami-dade-parcels";
  displayName = "Miami-Dade Parcels (ArcGIS)";
  category = "GIS / Parcels";
  accessMethod = IntegrationAccessMethod.API_REST;
  authType = "Public endpoint";
  cadence = "Near real-time";
  requiredEnv = [];

  async sync(): Promise<SyncResult> {
    const configuredUrl = process.env.MIAMI_DADE_PARCELS_URL;
    const whereCandidates = dedupe(
      [process.env.MIAMI_DADE_PARCELS_WHERE, DEFAULT_MIAMI_DADE_WHERE, "FOLIO IS NOT NULL", "1=1"].filter(
        Boolean
      ) as string[]
    );
    const limit = Number(process.env.ARCGIS_MAX_ROWS || 50);
    const candidateUrls = dedupe([configuredUrl, FALLBACK_MIAMI_DADE_PARCELS_URL].filter(Boolean) as string[]);

    if (!candidateUrls.length) {
      return { status: IntegrationStatus.NEEDS_CONFIG, message: "No Miami-Dade ArcGIS endpoint configured" };
    }

    const failures: string[] = [];

    for (const url of candidateUrls) {
      for (const whereClause of whereCandidates) {
        try {
          const records = await fetchArcgisSample(url, limit, whereClause);
          const fallbackUsed = configuredUrl && configuredUrl !== url;
          return {
            status: IntegrationStatus.OK,
            message: fallbackUsed ? "Miami-Dade parcels reachable (fallback endpoint)" : "Miami-Dade parcels reachable",
            records,
          };
        } catch (error) {
          failures.push(`${url} [${whereClause}]: ${describeError(error)}`);
        }
      }
    }

    return {
      status: IntegrationStatus.ERROR,
      message: `Miami-Dade parcels fetch failed: ${failures.join(" | ")}`,
    };
  }

  async getHealthStatus(): Promise<HealthStatus> {
    const result = await this.sync();
    return { status: result.status, message: result.message };
  }
}
