import { createHash } from "crypto";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { PrismaService } from "../shared/prisma.service";

/**
 * SYNC DE PARCELAS POR CORREDORES (14-oct-2026).
 *
 * POR QUE. Cada conector de parcelas pedia siempre los mismos 50 registros, sin avanzar y sin filtro. En 45 dias
 * Broward creo 50 deals (el primer dia) y actualizo 2.600 veces los mismos 50; Miami-Dade traia folios vacios y
 * terrenos del downtown, y Broward los folios mas bajos (Parkland). Ahora cada corrida pide la pagina siguiente de
 * las parcelas del buy box en los zips de los corredores, ordenadas por folio. El cursor queda en
 * Integration.meta y avanza solo despues de una ingesta exitosa; al terminar el recorrido vuelve a empezar, y
 * eso refresca los datos de cada parcela.
 *
 * Los corredores salen de buybox.json, el mismo archivo que usa la alerta: una sola definicion. Si no se puede
 * leer, el sync falla con el motivo; no vuelve a la muestra ciega.
 */
export const RUTA_BUYBOX_POR_DEFECTO = join(
  homedir(),
  "spark-dev-workspace/prive-deal-finder-ops/scripts/alerta/buybox.json",
);

/** Zips de Florida (32xxx a 34xxx) de los corredores Tier 1. Los de Nueva York y Carolina del Norte no aplican. */
export function zipsDeCorredores(ruta = process.env.BUYBOX_JSON || RUTA_BUYBOX_POR_DEFECTO): string[] {
  const bb = JSON.parse(readFileSync(ruta, "utf-8")) as { corredores_tier1?: Record<string, unknown> };
  const zips = new Set<string>();
  for (const [nombre, corredor] of Object.entries(bb.corredores_tier1 ?? {})) {
    if (nombre.startsWith("_") || !corredor || typeof corredor !== "object") continue;
    for (const z of (corredor as { zips?: unknown[] }).zips ?? []) {
      const t = String(z ?? "").trim();
      if (/^3[234]\d{3}$/.test(t)) zips.add(t);
    }
  }
  if (!zips.size) throw new Error(`buybox.json sin zips de corredores de Florida (${ruta})`);
  return [...zips].sort();
}

const zipsComo = (campo: string, zips: string[]) => `(${zips.map((z) => `${campo} LIKE '${z}%'`).join(" OR ")})`;

/**
 * Usos del buy box por codigo DOR de 2 cifras: tierra (00, 10, 40), multifamiliar (03, 08), comercial, oficina y
 * retail (11 a 39), industrial (41 a 49) y tierra publica para el carril P3 (80, 86 a 89). Afuera: unifamiliar,
 * condominio, townhouse, agricola, institucional, utilities y calles. Miami-Dade usa 4 cifras (las 2 primeras
 * son el DOR) y "0000" es un folio de referencia, no una parcela.
 */
export function whereMiamiDade(zips: string[]): string {
  return (
    `${zipsComo("TRUE_SITE_ZIP_CODE", zips)} AND (` +
    `(DOR_CODE_CUR LIKE '00%' AND DOR_CODE_CUR <> '0000') OR DOR_CODE_CUR LIKE '03%' OR DOR_CODE_CUR LIKE '08%' OR ` +
    `(DOR_CODE_CUR >= '1000' AND DOR_CODE_CUR < '5000') OR DOR_CODE_CUR LIKE '80%' OR ` +
    `(DOR_CODE_CUR >= '8600' AND DOR_CODE_CUR < '9000'))`
  );
}

export function whereBroward(zips: string[]): string {
  return (
    `${zipsComo("SITUS_ZIP_CODE", zips)} AND (` +
    `USE_CODE IN ('00','03','08','80','86','87','88','89') OR (USE_CODE >= '10' AND USE_CODE <= '49'))`
  );
}

export type CursorParcelas = { clave: string; offset: number; vueltas: number; actualizado?: string };

/** Identifica la consulta: si cambian la capa o los corredores, el recorrido empieza de nuevo. */
export function claveConsulta(capa: string, where: string): string {
  return createHash("sha1").update(`${capa}\n${where}`).digest("hex").slice(0, 12);
}

export function posicionDe(cursor: CursorParcelas | null | undefined, clave: string): { offset: number; vueltas: number } {
  if (!cursor || cursor.clave !== clave) return { offset: 0, vueltas: 0 };
  return { offset: Math.max(0, Math.floor(Number(cursor.offset) || 0)), vueltas: Math.max(0, Math.floor(Number(cursor.vueltas) || 0)) };
}

/** Si la pagina vino incompleta, se llego al final: la proxima corrida vuelve al principio. */
export function siguienteCursor(clave: string, offset: number, vueltas: number, recibidos: number, pedidos: number): CursorParcelas {
  const fin = recibidos < pedidos;
  return {
    clave,
    offset: fin ? 0 : offset + recibidos,
    vueltas: fin ? vueltas + 1 : vueltas,
    actualizado: new Date().toISOString(),
  };
}

export function parcelasPorCorrida(): number {
  const n = Number(process.env.PARCELAS_POR_CORRIDA || 200);
  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 1), 1000) : 200;
}

function leerMeta(texto?: string | null): Record<string, unknown> {
  try {
    const m = JSON.parse(texto || "{}");
    return m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function leerCursor(prisma: PrismaService, source: string): Promise<CursorParcelas | null> {
  const fila = await prisma.integration.findUnique({ where: { source }, select: { meta: true } });
  const c = leerMeta(fila?.meta).cursorParcelas as CursorParcelas | undefined;
  return c && typeof c.clave === "string" ? c : null;
}

/** Guarda el cursor sin pisar el resto de Integration.meta. */
export async function guardarCursor(prisma: PrismaService, source: string, cursor: CursorParcelas): Promise<void> {
  const fila = await prisma.integration.findUnique({ where: { source }, select: { meta: true } });
  const meta = { ...leerMeta(fila?.meta), cursorParcelas: cursor };
  await prisma.integration.upsert({
    where: { source },
    update: { meta: JSON.stringify(meta) },
    create: { source, meta: JSON.stringify(meta) },
  });
}
