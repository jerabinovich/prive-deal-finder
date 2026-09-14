import {
  HealthStatus,
  IntegrationAccessMethod,
  IntegrationConnector,
  IntegrationStatus,
  SyncResult,
} from "./types";

const BROWARD_SEARCH_CASES_FILED_URL = "https://api.browardclerk.org/api/search_cases_filed.json";
// 14-sep-2026 — LOS CODIGOS ANTERIORES NO EXISTEN.
// El conector preguntaba por FOR3, RPCF1-3 y FORE1-6, y la API devolvia vacio
// SIEMPRE. Pidiendo case_type_code=All para un viernes cualquiera aparecieron
// 200 casos civiles y los codigos de foreclosure REALES de Broward:
//   RPHRF6   Real Prop Homestead Res Fore $250,000 or More
//   RPNHRF5  Real Prop NHmstd Res Fore $50K to $250K
//   RPOR4    Real Prop Other Fore $50,000 or Less
// Son una familia RP*F* por tipo de vivienda y tramo de valor. En vez de
// enumerarla (y arriesgarse a perder un tramo nuevo), se pide TODO el civil del
// dia y se filtra por el nombre del tipo. Ademas sale MAS BARATO: 1 llamada por
// dia (2 unidades) en vez de 10.
const FORECLOSURE_TYPE_PATTERN = /forecl|\bfore\b/i;

type JsonRecord = Record<string, unknown>;

function toErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown error";
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" ? (value as JsonRecord) : {};
}

function readText(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }

  // 14-sep-2026: el endpoint .json devuelve "Case_Number", "Filed_Date" y
  // "Case_Type_Code" — mayusculas Y guion bajo a la vez. Ninguna de las
  // variantes de arriba (CaseNumber, case_number, CASE_NUMBER) los cubre, asi
  // que TODOS los campos salian vacios, la huella de deduplicacion quedaba en
  // "||" y los 11 foreclosures del dia se descartaban en silencio.
  // Segunda pasada normalizando: sin guiones ni mayusculas.
  const flat = (value: string) => value.replace(/[_\s-]/g, "").toLowerCase();
  const wanted = new Set(keys.map(flat));
  for (const [recordKey, value] of Object.entries(record)) {
    if (!wanted.has(flat(recordKey))) continue;
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

function parseXmlRow(block: string) {
  const row: JsonRecord = {};
  const pattern = /<([A-Za-z0-9_:-]+)>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block)) !== null) {
    const key = match[1];
    if (!key || key === "Case" || key === "case") continue;
    row[key] = decodeXmlEntities(match[2] || "");
  }
  return row;
}

function parseXmlCases(xmlText: string): JsonRecord[] {
  const blocks =
    xmlText.match(/<Case\b[\s\S]*?<\/Case>/gi) ||
    xmlText.match(/<case\b[\s\S]*?<\/case>/gi) ||
    [];

  if (blocks.length > 0) {
    return blocks.map((block) => parseXmlRow(block)).filter((row) => Object.keys(row).length > 0);
  }

  return [];
}

function firstXmlCandidate(payload: unknown): string | null {
  if (typeof payload === "string") {
    const text = payload.trim();
    if (text.startsWith("<") && /<Case\b|<case\b/i.test(text)) {
      return text;
    }
    return null;
  }

  if (Array.isArray(payload)) return null;

  const record = asRecord(payload);
  for (const value of Object.values(record)) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text.startsWith("<") && /<Case\b|<case\b/i.test(text)) {
      return text;
    }
  }

  return null;
}

function extractCaseRows(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) {
    return payload
      .map((item) => asRecord(item))
      .filter((item) => Object.keys(item).length > 0);
  }

  const record = asRecord(payload);

  const directArrays = [
    record.cases,
    record.Cases,
    record.data,
    record.Data,
    asRecord(record.Cases || {}).Case,
    asRecord(record.cases || {}).case,
  ];

  for (const value of directArrays) {
    if (Array.isArray(value)) {
      return value
        .map((item) => asRecord(item))
        .filter((item) => Object.keys(item).length > 0);
    }
  }

  const xmlCandidate = firstXmlCandidate(payload);
  if (xmlCandidate) {
    return parseXmlCases(xmlCandidate);
  }

  return [];
}

function parseApiResponse(text: string): JsonRecord[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("<")) {
    return parseXmlCases(trimmed);
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;

    if (typeof parsed === "string") {
      return parseApiResponse(parsed);
    }

    const rows = extractCaseRows(parsed);
    if (rows.length > 0) return rows;

    const record = asRecord(parsed);
    for (const value of Object.values(record)) {
      if (typeof value === "string" && value.trim().startsWith("<")) {
        const xmlRows = parseXmlCases(value);
        if (xmlRows.length > 0) return xmlRows;
      }
    }

    return [];
  } catch (_error) {
    return [];
  }
}

function parseCaseTypeList(value: string | undefined) {
  const raw = String(value || "")
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  return raw.length ? Array.from(new Set(raw)) : ["All"];
}

/**
 * 13-sep-2026: mandaba "9/13/2026" y la API del Clerk pide ISO.
 * De su documentacion tecnica (Request Parameters, parametro `date`):
 *   "Date Only: date=2009-11-23"  ·  Accepted Values: "yyyy-mm-dd"
 * No se detecto antes porque el saldo agotado rechazaba las consultas antes de
 * que la fecha llegara a validarse.
 */
function formatBrowardDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function normalizeQuotedText(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      return JSON.parse(trimmed) as string;
    } catch (_error) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function isInvalidSearchResponse(text: string) {
  const normalized = normalizeQuotedText(text).toLowerCase();
  return normalized.includes("invalid cases filed search") || normalized.includes("invalid date_to_use");
}

/**
 * La API del Clerk devuelve HTTP 200 TAMBIEN cuando rechaza la consulta: el
 * cuerpo es un texto suelto entre comillas, p.ej. "Low Unit Balance !".
 *
 * 13-sep-2026 — esto enmascaraba una falla total. Con saldo agotado, las 20
 * llamadas fueron rechazadas y el conector reporto
 * `status: OK, "no filings in selected window"`, porque contaba HTTP 200 como
 * exito y parseApiResponse() devuelve [] ante un texto suelto. O sea: decia
 * "no hay expedientes" cuando la verdad era "no me dejaron preguntar".
 *
 * Por eso el criterio es general y no una lista de mensajes conocidos: un
 * resultado de verdad es JSON (objeto o array). Si el cuerpo es solo texto, es
 * un error de la API — aunque el mensaje sea nuevo y no lo hayamos visto nunca.
 */
function isApiRejectionMessage(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // 14-sep: el XML tambien es una respuesta valida — este endpoint responde XML
  // si no se pide .json. Marcarlo como rechazo fue un falso positivo mio.
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith("<")) return false;
  try {
    return typeof JSON.parse(trimmed) === "string";
  } catch {
    return true;
  }
}

function parseDate(value: string) {
  if (!value) return null;

  const direct = new Date(value);
  if (Number.isFinite(direct.getTime())) return direct;

  const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const date = new Date(Number(slash[3]), Number(slash[1]) - 1, Number(slash[2]));
    if (Number.isFinite(date.getTime())) return date;
  }

  return null;
}

function buildCaseFingerprint(caseRow: JsonRecord) {
  const caseNumber = readText(caseRow, ["CaseNumber", "case_number", "CASE_NUMBER", "CaseNo", "CASE_NO"]);
  const filingDate = readText(caseRow, ["DateFiled", "FilingDate", "FILED_DATE", "date_filed"]);
  const caseType = readText(caseRow, ["CaseTypeCode", "case_type_code", "CASE_TYPE_CODE", "CaseType"]);
  return `${caseNumber}|${filingDate}|${caseType}`;
}

function normalizeCaseRecord(caseRow: JsonRecord, fallbackType: string): JsonRecord {
  const caseNumber = readText(caseRow, ["CaseNumber", "case_number", "CASE_NUMBER", "CaseNo", "CASE_NO"]);
  const caseTypeCode =
    readText(caseRow, ["CaseTypeCode", "case_type_code", "CASE_TYPE_CODE", "CaseType"]) || fallbackType;
  const caseTypeDescription = readText(caseRow, [
    "CaseTypeDescription",
    "case_type_description",
    "CASE_TYPE_DESCRIPTION",
    "CaseTypeDesc",
  ]);
  const filingDate = readText(caseRow, ["DateFiled", "FilingDate", "FILED_DATE", "date_filed"]);
  const status = readText(caseRow, ["CaseStatus", "Status", "CASE_STATUS", "status"]);
  const propertyAddress = readText(caseRow, [
    "PropertyAddress",
    "property_address",
    "PROPERTY_ADDRESS",
    "Address",
    "SiteAddress",
  ]);

  const observedAt = parseDate(filingDate);

  return {
    caseNumber: caseNumber || null,
    caseTypeCode,
    caseTypeDescription: caseTypeDescription || null,
    filedDate: filingDate || null,
    status: status || "CONFIRMED",
    // Codigos reales de Broward: RPHRF* (homestead), RPNHRF* (no homestead),
    // RPOR* (otros). Una ejecucion hipotecaria presentada es un hecho, no una
    // inferencia: confianza alta.
    confidence: /^RP.*F/i.test(caseTypeCode) || /^FORE/i.test(caseTypeCode) ? "HIGH" : "MEDIUM",
    observedAt: observedAt ? observedAt.toISOString() : null,
    address: propertyAddress || null,
    // 14-sep-2026: el expediente NO trae folio ni direccion de la propiedad —
    // trae la CARATULA ("Banco Plaintiff vs. Fulano, et al Defendant"). El
    // demandado es el dueño, y su nombre es la unica llave que tenemos para
    // encontrar la propiedad en el catastro. Se extrae aca y se lleva en el
    // registro para que el servicio pueda resolverlo.
    caption: readText(caseRow, ["Caption", "caption", "CAPTION", "Style"]) || null,
    defendantName: extractDefendant(readText(caseRow, ["Caption", "caption", "CAPTION", "Style"])),
    metadata: caseRow,
  };
}

/**
 * Saca el nombre del demandado de la caratula.
 *
 * Formato del Clerk: "<demandante> Plaintiff vs. <demandado>, et al Defendant".
 * Medido sobre los 11 expedientes del 11-sep: resuelve 7. Los 4 que no son
 * apellidos compuestos ("St. Urbain-Dupigny"), empresas con la razon social
 * partida, y una caratula que arranca con "THE TRUSTEES OF THE...". Se devuelve
 * el nombre crudo y el servicio decide como buscarlo.
 */
function extractDefendant(caption: string): string | null {
  if (!caption) return null;
  const m = /vs\.?\s*([\s\S]+?)(?:,\s*et al|\s+Defendant\b|$)/i.exec(caption);
  if (!m) return null;
  const name = m[1].replace(/\s+/g, " ").trim();
  return name || null;
}

export class BrowardForeclosureConnector implements IntegrationConnector {
  source = "broward-foreclosure";
  displayName = "Broward County Clerk of Courts (Official)";
  category = "Distress / Foreclosure";
  accessMethod = IntegrationAccessMethod.API_REST;
  authType = "AuthKey";
  cadence = "Daily";
  requiredEnv = ["BROWARD_FORECLOSURE_API_KEY"];

  private endpoint() {
    return process.env.BROWARD_FORECLOSURE_URL?.trim() || BROWARD_SEARCH_CASES_FILED_URL;
  }

  private authKey() {
    return process.env.BROWARD_FORECLOSURE_API_KEY?.trim() || "";
  }

  private caseTypes() {
    return parseCaseTypeList(process.env.BROWARD_FORECLOSURE_CASE_TYPES);
  }

  private lookbackDays() {
    const parsed = Number(process.env.BROWARD_FORECLOSURE_LOOKBACK_DAYS || 7);
    if (!Number.isFinite(parsed) || parsed < 1) return 7;
    return Math.min(60, Math.round(parsed));
  }

  private maxRequests() {
    const parsed = Number(process.env.BROWARD_FORECLOSURE_MAX_REQUESTS || 200);
    if (!Number.isFinite(parsed) || parsed < 1) return 200;
    return Math.min(500, Math.round(parsed));
  }

  private maxCases() {
    const parsed = Number(process.env.BROWARD_FORECLOSURE_MAX_CASES || 250);
    if (!Number.isFinite(parsed) || parsed < 1) return 250;
    return Math.min(1000, Math.round(parsed));
  }

  private courtTypeCode() {
    return String(process.env.BROWARD_FORECLOSURE_COURT_TYPE || "CV").trim().toUpperCase() || "CV";
  }

  private dateToUse() {
    const raw = String(process.env.BROWARD_FORECLOSURE_DATE_TO_USE || "filed").trim().toLowerCase();
    return raw === "created" ? "created" : "filed";
  }

  private buildUrl(caseTypeCode: string, date: string, pageNumber: number) {
    const url = new URL(this.endpoint());
    url.searchParams.set("court_type_code", this.courtTypeCode());
    url.searchParams.set("date_to_use", this.dateToUse());
    url.searchParams.set("date", date);
    url.searchParams.set("auth_key", this.authKey());
    url.searchParams.set("page_number", String(pageNumber));
    url.searchParams.set("case_type_code", caseTypeCode);
    return url.toString();
  }

  async sync(): Promise<SyncResult> {
    const authKey = this.authKey();
    if (!authKey) {
      return {
        status: IntegrationStatus.NEEDS_CONFIG,
        message: "BROWARD_FORECLOSURE_API_KEY is not configured",
      };
    }

    const lookbackDays = this.lookbackDays();
    const maxCases = this.maxCases();
    const maxRequests = this.maxRequests();
    const now = new Date();
    // 13-sep-2026: se saltean sabados y domingos. Los tribunales no reciben
    // expedientes el fin de semana, asi que consultarlos es gastar unidades
    // (2 por llamada, compradas) para que la respuesta venga vacia siempre.
    // Detectado corriendo un domingo: con lookback=2 consulto sabado y domingo,
    // o sea los dos dias garantizados sin datos.
    const datesToQuery: string[] = [];
    for (let offset = 0; datesToQuery.length < lookbackDays && offset < lookbackDays + 7; offset += 1) {
      const date = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
      const weekday = date.getDay();
      if (weekday === 0 || weekday === 6) continue;
      datesToQuery.push(formatBrowardDate(date));
    }

    const caseTypes = this.caseTypes();

    const gathered: JsonRecord[] = [];
    const failureDetails: Array<Record<string, unknown>> = [];
    let requestsMade = 0;
    let successfulLookups = 0;

    for (const caseTypeCode of caseTypes) {
      for (const date of datesToQuery) {
        if (requestsMade >= maxRequests) {
          break;
        }

        requestsMade += 1;
        const requestUrl = this.buildUrl(caseTypeCode, date, 1);
        try {
          const response = await fetch(requestUrl, {
            method: "GET",
            headers: {
              Accept: "application/json, text/plain, */*",
            },
          });

          if (!response.ok) {
            failureDetails.push({
              caseTypeCode,
              date,
              status: response.status,
              message: `HTTP ${response.status}`,
            });
            continue;
          }

          const text = await response.text();
          if (isInvalidSearchResponse(text)) {
            failureDetails.push({
              caseTypeCode,
              date,
              status: "INVALID_SEARCH_PARAMS",
              message: normalizeQuotedText(text),
            });
            continue;
          }

          if (isApiRejectionMessage(text)) {
            failureDetails.push({
              caseTypeCode,
              date,
              status: "API_REJECTED",
              message: normalizeQuotedText(text),
            });
            continue;
          }

          const rows = parseApiResponse(text);
          successfulLookups += 1;
          const matchesBefore = gathered.length;

          // Con case_type_code=All viene TODO el civil del dia (deudas de
          // tarjeta, desalojos, negligencia...). Nos quedamos solo con lo que el
          // propio Clerk nombra como foreclosure.
          for (const row of rows) {
            const record = row as Record<string, unknown>;
            const typeName = String(record.Case_Type ?? record.case_type ?? "");
            const typeCode = String(record.Case_Type_Code ?? record.case_type_code ?? caseTypeCode);
            if (caseTypeCode === "All" && !FORECLOSURE_TYPE_PATTERN.test(typeName)) continue;
            gathered.push(normalizeCaseRecord(row, typeCode));
          }

          // 14-sep-2026: cortaba contando TODAS las filas, pero con
          // case_type_code=All eso incluye deudas de tarjeta y desalojos. Un
          // lunes a la manana trajo 200 casos civiles, cero foreclosures, y el
          // conector corto igual sin mirar el viernes. Ahora corta solo si
          // encontro foreclosures DE VERDAD.
          if (gathered.length > matchesBefore) {
            break;
          }
        } catch (error) {
          failureDetails.push({
            caseTypeCode,
            date,
            status: "FETCH_FAILED",
            message: toErrorMessage(error),
          });
        }
      }

      if (requestsMade >= maxRequests) break;
    }

    if (!successfulLookups) {
      return {
        status: IntegrationStatus.ERROR,
        message: "Broward foreclosure sync failed for all case-type lookups",
        metrics: {
          caseTypesQueried: caseTypes.length,
          successfulLookups,
          failedLookups: failureDetails.length,
          failureDetails,
          lookedBackDays: lookbackDays,
          requestsMade,
          maxRequests,
          queriedDates: datesToQuery,
        },
      };
    }

    const deduped = new Map<string, JsonRecord>();
    for (const row of gathered) {
      const key = buildCaseFingerprint(row);
      if (!key.replace(/\|/g, "").trim()) {
        continue;
      }
      if (!deduped.has(key)) {
        deduped.set(key, row);
      }
    }

    const records = Array.from(deduped.values()).slice(0, maxCases);

    const message = records.length
      ? "Broward foreclosure filings fetched"
      : "Broward foreclosure query completed (no filings in selected window)";

    return {
      status: IntegrationStatus.OK,
      message,
      records,
      metrics: {
        lookedBackDays: lookbackDays,
        requestsMade,
        maxRequests,
        queriedDates: datesToQuery,
        courtTypeCode: this.courtTypeCode(),
        dateToUse: this.dateToUse(),
        caseTypesQueried: caseTypes.length,
        successfulLookups,
        failedLookups: failureDetails.length,
        sampledRecords: records.length,
        cappedAt: maxCases,
        ...(failureDetails.length ? { failureDetails } : {}),
      },
    };
  }

  async getHealthStatus(): Promise<HealthStatus> {
    if (!this.authKey()) {
      return {
        status: IntegrationStatus.NEEDS_CONFIG,
        message: "BROWARD_FORECLOSURE_API_KEY is not configured",
      };
    }

    return {
      status: IntegrationStatus.OK,
      message: "Broward foreclosure connector is configured. Execute sync to validate authorization and ingest.",
    };
  }
}
