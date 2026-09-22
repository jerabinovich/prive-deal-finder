import * as fs from "fs";
import { PrismaClient } from "@prisma/client";
import * as os from "os";
import * as path from "path";

/**
 * Deuda registrada por folio, leida del resultado de consultar.py (Clerk de Miami-Dade).
 *
 * POR QUE ASI (22-sep-2026). La consulta al Clerk cuesta USD 0,20 por folio y ya tiene
 * sus frenos en prive-deal-finder-ops/scripts/miami-dade-official-records/consultar.py:
 * lista explicita, simulacro por defecto, tope de gasto, reuso de lo ya pagado. Este
 * modulo NO consulta al Clerk: importa el resultado.json que ese script ya pago. Un sync
 * desde la web o desde el cron de las 8 no puede gastar una unidad.
 *
 * SOLO INFORMATIVO, decision de JR del 22-sep. Se guarda en StagingRecord y en ningun otro
 * lado: ni DealDistressSignal ni DealEvent (los dos alimentan el triage), ni DealMetric.debt
 * (la deuda "vigente probable" es una inferencia sobre un indice incompleto, no un dato de
 * underwriting). Ningun deal cambia de lane, accion, etapa ni score por esto.
 *
 * Lo que el indice por folio permite decir, medido el 22-sep sobre 31 folios: trae las
 * hipotecas pero casi nunca sus satisfacciones (0 SAT en 488 documentos), a veces tampoco
 * trae hipotecas, y no trae el monto de los gravamenes. Por eso la cifra es "vigente
 * probable" y la ficha lo dice.
 */

export const MIAMI_DADE_CLERK_SOURCE = "miami-dade-clerk";
export const RECORDED_DEBT_SCHEMA_VERSION = 1;
export const RECORDED_DEBT_STAGING_STATUS = "INFORMATIONAL";

const MAX_RESULT_FILE_BYTES = 20 * 1024 * 1024;
const RESULT_FILE_PARTS = ["prive-deal-finder-ops", "scripts", "miami-dade-official-records", "resultado.json"];
const OTHER_DEBT_DOC_TYPES = new Set(["LIS", "JUD", "AGR"]);

export type MortgageStatus = "RELEASED" | "PREDATES_TRANSFER" | "EXPIRED" | "LIKELY_OUTSTANDING" | "UNKNOWN";

export interface RecordedMortgage {
  cfn: string;
  recordedOn: string | null;
  amount: number;
  status: MortgageStatus;
  reason: string;
  parties: string[];
}

export interface RecordedDebtDocument {
  cfn: string;
  docType: string;
  recordedOn: string | null;
  amount: number;
  parties: string[];
  released: boolean;
}

export interface RecordedDebtSnapshot {
  schemaVersion: number;
  folio: string;
  outcome: "RECORDS_FOUND" | "NO_RECORDS";
  /** Cuando contesto el Clerk (hora local de Spark), sacado del nombre del crudo o de la corrida. */
  queriedAt: string | null;
  sourceRunAt: string | null;
  clerkStatusDesc: string | null;
  documentCount: number;
  likelyOutstandingDebt: number;
  /** Suma de toda hipoteca sin cancelacion en el indice: un techo, no la deuda. */
  recordedDebtCeiling: number;
  mortgages: RecordedMortgage[];
  otherDebtDocuments: RecordedDebtDocument[];
  lastTransfer: { cfn: string; recordedOn: string | null; docType: string; price: number } | null;
  lastPurchaseWithoutLaterMortgage: boolean;
  titleCertificates: string[];
  liens: {
    total: number;
    releasedInIndex: number;
    last24Months: number;
    lastRecordedOn: string | null;
    frequentParties: Array<{ name: string; count: number }>;
  };
}

export interface SkippedClerkEntry {
  folio: string;
  reason: string;
}

export interface ParsedClerkResult {
  runAt: string | null;
  snapshots: RecordedDebtSnapshot[];
  skipped: SkippedClerkEntry[];
}

export interface ClerkResultPathResolution {
  resolvedPath: string | null;
  checkedPaths: string[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function money(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function count(value: unknown): number {
  const parsed = money(value);
  return parsed > 0 ? Math.round(parsed) : 0;
}

/** "2026-07-23T00:00:00" o "2026-07-23" -> "2026-07-23"; cualquier otra cosa -> null. */
function isoDay(value: unknown): string | null {
  const raw = text(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function names(value: unknown, max = 4): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean).slice(0, max);
}

function mortgageStatus(raw: string): MortgageStatus {
  const value = raw.toLowerCase();
  if (value === "cancelada") return "RELEASED";
  if (value === "anterior a un traspaso") return "PREDATES_TRANSFER";
  if (value === "vencida") return "EXPIRED";
  if (value === "vigente probable") return "LIKELY_OUTSTANDING";
  return "UNKNOWN";
}

/** El crudo se llama <folio>-AAAAMMDD-HHMMSS.xml: esa es la hora en que contesto el Clerk. */
function queriedAtFromRawFile(file: string): string | null {
  const match = /-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.[a-z]+$/i.exec(file);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
}

export function normalizeFolio(value: string | null | undefined): string {
  return text(value).replace(/[^\d]/g, "");
}

export function resolveClerkResultPath(configuredPath?: string): ClerkResultPathResolution {
  const candidates = [
    configuredPath?.trim(),
    process.env.MIAMI_DADE_CLERK_RESULT_PATH?.trim(),
    // La API corre con cwd en la raiz del repo; con npm -w corre en apps/api.
    path.resolve(process.cwd(), "..", ...RESULT_FILE_PARTS),
    path.resolve(process.cwd(), "..", "..", "..", ...RESULT_FILE_PARTS),
    path.join(os.homedir(), "spark-dev-workspace", ...RESULT_FILE_PARTS),
  ].filter(Boolean) as string[];

  const checkedPaths = Array.from(new Set(candidates));
  const resolvedPath = checkedPaths.find((candidate) => fs.existsSync(candidate)) ?? null;
  return { resolvedPath, checkedPaths };
}

export function readClerkResultFile(filePath: string): unknown {
  const size = fs.statSync(filePath).size;
  if (size > MAX_RESULT_FILE_BYTES) {
    throw new Error(`resultado.json pesa ${size} bytes, mas que el maximo de ${MAX_RESULT_FILE_BYTES}; no se importa`);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : "JSON invalido";
    throw new Error(`resultado.json no es JSON valido (${detail}); no se importa`);
  }
}

function normalizeEntry(
  folio: string,
  entry: Record<string, unknown>,
  runAt: string | null,
): RecordedDebtSnapshot | SkippedClerkEntry {
  if ("error" in entry) {
    return { folio, reason: `la consulta fallo: ${text(entry.error) || "sin detalle"}` };
  }

  const statusDesc = text(entry.status_desc) || null;
  const rawFile = text(entry.origen);
  const queriedAt = (rawFile && queriedAtFromRawFile(rawFile)) || runAt;
  const documentCount = count(entry.documentos);
  const base = {
    schemaVersion: RECORDED_DEBT_SCHEMA_VERSION,
    folio,
    queriedAt,
    sourceRunAt: runAt,
    clerkStatusDesc: statusDesc,
  };

  if (!("documentos" in entry)) {
    return { folio, reason: `el Clerk rechazo la consulta: ${statusDesc || text(entry.status) || "sin detalle"}` };
  }

  if (documentCount === 0) {
    // Solo "No Records Found" dice que el folio no tiene documentos. Otra respuesta sin
    // lista no prueba nada (el JSON del Clerk omite la lista) y no se muestra como vacio.
    if (!/no record/i.test(statusDesc || "")) {
      return { folio, reason: `respuesta sin documentos que no dice "No Records Found": ${statusDesc || "sin detalle"}` };
    }
    return {
      ...base,
      outcome: "NO_RECORDS",
      documentCount: 0,
      likelyOutstandingDebt: 0,
      recordedDebtCeiling: 0,
      mortgages: [],
      otherDebtDocuments: [],
      lastTransfer: null,
      lastPurchaseWithoutLaterMortgage: false,
      titleCertificates: [],
      liens: { total: 0, releasedInIndex: 0, last24Months: 0, lastRecordedOn: null, frequentParties: [] },
    };
  }

  const liensRaw = asRecord(entry.gravamenes);
  if (!Array.isArray(entry.hipotecas) || !liensRaw) {
    return { folio, reason: "resultado sin analisis de deuda: correr consultar.py con el parche 5 (se reusa lo pagado)" };
  }

  const mortgages: RecordedMortgage[] = [];
  for (const item of entry.hipotecas) {
    const record = asRecord(item);
    if (!record) continue;
    const rawStatus = text(record.estado);
    mortgages.push({
      cfn: text(record.cfn),
      recordedOn: isoDay(record.fecha),
      amount: money(record.monto),
      status: mortgageStatus(rawStatus),
      reason: text(record.motivo) || (mortgageStatus(rawStatus) === "UNKNOWN" ? rawStatus : ""),
      parties: names(record.partes),
    });
  }

  const otherDebtDocuments: RecordedDebtDocument[] = [];
  for (const item of Array.isArray(entry.deuda) ? entry.deuda : []) {
    const record = asRecord(item);
    const docType = text(record?.tipo).toUpperCase();
    if (!record || !OTHER_DEBT_DOC_TYPES.has(docType)) continue;
    otherDebtDocuments.push({
      cfn: text(record.cfn),
      docType,
      recordedOn: isoDay(record.fecha),
      amount: money(record.monto),
      parties: names(record.partes),
      released: record.cancelado === true,
    });
  }
  otherDebtDocuments.sort((a, b) => String(b.recordedOn ?? "").localeCompare(String(a.recordedOn ?? "")));

  const transfer = asRecord(entry.ultimo_traspaso);
  const frequent = asRecord(liensRaw.partes_frecuentes) ?? {};

  return {
    ...base,
    outcome: "RECORDS_FOUND",
    documentCount,
    likelyOutstandingDebt: Math.round(money(entry.deuda_vigente_probable)),
    recordedDebtCeiling: Math.round(money(entry.deuda_viva_registrada)),
    mortgages,
    otherDebtDocuments,
    lastTransfer: transfer
      ? {
          cfn: text(transfer.cfn),
          recordedOn: isoDay(transfer.fecha),
          docType: text(transfer.tipo).toUpperCase(),
          price: money(transfer.precio),
        }
      : null,
    lastPurchaseWithoutLaterMortgage: entry.ultima_compra_sin_hipoteca_en_indice === true,
    titleCertificates: (Array.isArray(entry.certificados_de_titulo) ? entry.certificados_de_titulo : [])
      .map((value) => isoDay(value))
      .filter((value): value is string => Boolean(value)),
    liens: {
      total: count(liensRaw.total),
      releasedInIndex: count(liensRaw.liberados_en_indice),
      last24Months: count(liensRaw.ultimos_24_meses),
      lastRecordedOn: isoDay(liensRaw.ultimo),
      frequentParties: Object.entries(frequent)
        .map(([name, value]) => ({ name: text(name), count: count(value) }))
        .filter((item) => item.name && item.count > 0)
        .slice(0, 3),
    },
  };
}

/**
 * Valida y normaliza el resultado.json entero. Tira error (y no se importa nada) si no es
 * una corrida COMPLETA: consultar.py nunca escribe resultado.json de una corrida abortada,
 * asi que otra cosa en ese archivo es un archivo que no es el que creemos.
 */
export function parseClerkResult(raw: unknown): ParsedClerkResult {
  const root = asRecord(raw);
  if (!root) throw new Error("resultado.json no es un objeto; no se importa");

  const state = text(root.estado);
  if (state !== "COMPLETA") {
    throw new Error(`resultado.json no es una corrida COMPLETA (estado: ${state || "ausente"}); no se importa`);
  }

  const results = asRecord(root.resultados);
  if (!results) throw new Error("resultado.json no trae resultados; no se importa");

  const runAt = text(root.corrida) || null;
  const snapshots: RecordedDebtSnapshot[] = [];
  const skipped: SkippedClerkEntry[] = [];

  for (const [key, value] of Object.entries(results)) {
    const folio = normalizeFolio(key);
    if (folio.length < 10 || folio !== key.trim()) {
      skipped.push({ folio: key, reason: "clave que no es un folio" });
      continue;
    }
    const entry = asRecord(value);
    if (!entry) {
      skipped.push({ folio, reason: "entrada que no es un objeto" });
      continue;
    }
    const normalized = normalizeEntry(folio, entry, runAt);
    if ("outcome" in normalized) snapshots.push(normalized);
    else skipped.push(normalized);
  }

  return { runAt, snapshots, skipped };
}

export type RecordedDebtStore = Pick<PrismaClient, "stagingRecord" | "deal">;

/**
 * Guarda una fila de StagingRecord por folio SOLO si cambio respecto de la ultima: el cron
 * puede reimportar el mismo archivo todas las mañanas sin llenar la tabla. Lee deals, no
 * los escribe.
 */
export async function storeRecordedDebt(store: RecordedDebtStore, snapshots: RecordedDebtSnapshot[]) {
  let storedRecords = 0;
  let unchangedRecords = 0;
  const now = new Date();

  for (const snapshot of snapshots) {
    const payload = JSON.stringify(snapshot);
    const latest = await store.stagingRecord.findFirst({
      where: { source: MIAMI_DADE_CLERK_SOURCE, sourceRecordId: snapshot.folio },
      orderBy: { receivedAt: "desc" },
      select: { payload: true, receivedAt: true },
    });
    if (latest?.payload === payload) {
      unchangedRecords += 1;
      continue;
    }
    await store.stagingRecord.create({
      data: {
        source: MIAMI_DADE_CLERK_SOURCE,
        sourceRecordId: snapshot.folio,
        payload,
        status: RECORDED_DEBT_STAGING_STATUS,
        processedAt: now,
      },
    });
    storedRecords += 1;
  }

  const folios = snapshots.map((snapshot) => snapshot.folio);
  const matched = folios.length
    ? await store.deal.findMany({ where: { parcelId: { in: folios } }, select: { parcelId: true } })
    : [];
  const matchedSet = new Set(matched.map((item) => normalizeFolio(item.parcelId)));

  return {
    folios: folios.length,
    storedRecords,
    unchangedRecords,
    matchedDeals: folios.filter((folio) => matchedSet.has(folio)).length,
    unmatchedFolios: folios.filter((folio) => !matchedSet.has(folio)).slice(0, 100),
  };
}

export type RecordedDebtView =
  | { available: false; informationalOnly: true; folio: string | null; reason: string }
  | {
      available: true;
      informationalOnly: true;
      folio: string;
      importedAt: Date;
      snapshot: RecordedDebtSnapshot;
    };

/** Lo que ve la ficha del deal. Lee la ultima fila del folio; no escribe nada. */
export async function readRecordedDebt(
  store: Pick<PrismaClient, "stagingRecord">,
  deal: { parcelId?: string | null; market?: string | null },
): Promise<RecordedDebtView> {
  const folio = normalizeFolio(deal.parcelId);
  if (!folio) {
    return { available: false, informationalOnly: true, folio: null, reason: "El deal no tiene folio." };
  }
  if (deal.market && deal.market !== "Miami-Dade") {
    return {
      available: false,
      informationalOnly: true,
      folio,
      reason: "El Clerk de Miami-Dade solo cubre folios de Miami-Dade.",
    };
  }

  const latest = await store.stagingRecord.findFirst({
    where: { source: MIAMI_DADE_CLERK_SOURCE, sourceRecordId: folio },
    orderBy: { receivedAt: "desc" },
    select: { payload: true, receivedAt: true },
  });
  if (!latest) {
    return {
      available: false,
      informationalOnly: true,
      folio,
      reason: "Este folio no está en la consulta al Clerk importada.",
    };
  }

  let snapshot: RecordedDebtSnapshot | null = null;
  try {
    const parsed = JSON.parse(latest.payload) as RecordedDebtSnapshot;
    if (parsed && parsed.schemaVersion === RECORDED_DEBT_SCHEMA_VERSION && parsed.folio === folio) snapshot = parsed;
  } catch {
    snapshot = null;
  }
  if (!snapshot) {
    return {
      available: false,
      informationalOnly: true,
      folio,
      reason: "La fila guardada no tiene el formato esperado; volver a importar.",
    };
  }

  return { available: true, informationalOnly: true, folio, importedAt: latest.receivedAt, snapshot };
}
