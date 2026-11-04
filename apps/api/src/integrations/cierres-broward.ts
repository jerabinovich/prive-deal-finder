import type { PrismaClient } from "@prisma/client";
import { analizarDemandado, coincideDueno } from "./broward-demandado";
import { normalizarCaso, type DocumentoOR, type Indice } from "./registro-oficial-broward";

/**
 * EL FORECLOSURE QUE TERMINA ANTES DEL REMATE (4-nov-2026, JR: "arregla").
 *
 * Medido el 4-nov: CACE26015855 (GNZ Funding contra Javiac Enterprises, el duplex de 6546 NW 24 Ct, Margate) seguia en
 * PRE_FORECLOSURE y entre los candidatos de la alerta, pero el 26-oct-2026 Javiac vendio el folio a North Lauderdale LLC
 * por USD 425.000 y GNZ registro ese mismo dia un RST con el numero del caso. El Deal Finder solo miraba lo que trae el
 * Clerk, y el Clerk no avisa que el caso termino.
 *
 * El indice diario de Official Records (el FTP gratis del condado, registro-oficial-broward.ts) trae los dos hechos:
 *   - LIBERACION: un RST con el numero del caso, registrado desde la demanda, en el que figura el demandado. En los indices
 *     reales el RST es la satisfaccion de una hipoteca, la liberacion de un lien o la de un lis pendens; con el numero del
 *     caso, es el demandante liberando el expediente.
 *   - VENTA: una escritura (D) del folio del deal, registrada desde la demanda, en la que el demandado vende (lado D) por
 *     USD 1.000 o mas. Una transferencia nominal (USD 10 a la familia) no cierra nada: la hipoteca sigue.
 * Cualquiera de los dos cierra el expediente para el Deal Finder: el dueño ya no esta en distress, o ya no es el dueño.
 *
 * POR QUE UNA SENAL APARTE: el cierre queda como senal propia (FUENTE_CIERRE) en CLEARED, que ni el triage ni el puntaje
 * cuentan como distress, y la senal del foreclosure de ese deal y ese caso pasa a CLEARED. La ingesta reescribe la senal del
 * foreclosure cada vez que el caso vuelve del Clerk; con el cierre guardado aparte, la ingesta la deja en CLEARED.
 */
export const FUENTE_CIERRE = "broward-cierre";
export const ESTADO_CERRADA = "CLEARED";
export const TIPO_LIBERACION = "RST";
export const TIPO_ESCRITURA = "D";
export const MONTO_MINIMO_VENTA = 1000;
const FUENTE_FORECLOSURE = "broward-foreclosure";

export type SenalForeclosure = {
  id: string;
  dealId: string;
  externalId: string | null;
  metadata: string | null;
  observedAt?: Date | null;
  deal?: { parcelId: string | null } | null;
};
type Hecho = { instrumento: string; fecha: string };
export type Cierre = {
  caso: string;
  motivos: Array<"LIBERACION" | "VENTA">;
  liberacion?: Hecho;
  venta?: Hecho & { monto: number; compradores: string[] };
};

const limpiarFolio = (folio: string | null | undefined) => String(folio ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
const aIso = (aaaammdd: string) => `${aaaammdd.slice(0, 4)}-${aaaammdd.slice(4, 6)}-${aaaammdd.slice(6, 8)}`;
const primero = (docs: DocumentoOR[]) =>
  [...docs].sort((a, b) => (a.fecha === b.fecha ? a.instrumento.localeCompare(b.instrumento) : a.fecha.localeCompare(b.fecha)))[0];

/** "09/29/2026" (el Clerk) o "2026-09-29..." a AAAAMMDD; null si no se puede leer. */
export function aAaaammdd(fecha: unknown): string | null {
  const s = String(fecha ?? "").trim();
  const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (us) return `${us[3]}${us[1]}${us[2]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return iso ? `${iso[1]}${iso[2]}${iso[3]}` : null;
}

function leerMetadata(texto: string | null): Record<string, unknown> {
  try {
    const m = JSON.parse(texto ?? "{}");
    return m && typeof m === "object" ? (m as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function sumar(mapa: Map<string, DocumentoOR[]>, clave: string, d: DocumentoOR) {
  const lista = mapa.get(clave);
  if (lista) lista.push(d);
  else mapa.set(clave, [d]);
}

/** Los RST con numero de caso y las escrituras con folio de la ventana. Vacios si el indice no trae ninguno. */
function hechosDelIndice(ind: Indice) {
  const liberaciones = new Map<string, DocumentoOR[]>();
  const escrituras = new Map<string, DocumentoOR[]>();
  for (const d of ind.docs.values()) {
    if (d.tipo === TIPO_LIBERACION && normalizarCaso(d.caso)) sumar(liberaciones, normalizarCaso(d.caso), d);
    else if (d.tipo === TIPO_ESCRITURA && limpiarFolio(d.folio)) sumar(escrituras, limpiarFolio(d.folio), d);
  }
  return { liberaciones, escrituras };
}

/** Pura: el cierre de cada senal de foreclosure que el indice trae, por id de senal. */
export function cierresDelIndice(ind: Indice, senales: SenalForeclosure[]): Map<string, Cierre> {
  const { liberaciones, escrituras } = hechosDelIndice(ind);
  const cierres = new Map<string, Cierre>();
  if (!liberaciones.size && !escrituras.size) return cierres;
  const partes = (d: DocumentoOR, lado?: string) => (ind.partes.get(d.instrumento) ?? []).filter((p) => !lado || p.lado === lado);
  for (const s of senales) {
    const caso = normalizarCaso(s.externalId);
    const meta = leerMetadata(s.metadata);
    const demandado = analizarDemandado(String(meta.defendantName ?? ""));
    const desde = aAaaammdd(meta.filedDate) ?? (s.observedAt ? aAaaammdd(s.observedAt.toISOString()) : null);
    if (!caso || !demandado || !desde) continue;
    const delDemandado = (d: DocumentoOR, lado?: string) => partes(d, lado).some((p) => coincideDueno(demandado, p.nombre));
    const liberacionesDelCaso = (liberaciones.get(caso) ?? []).filter((d) => d.fecha >= desde && delDemandado(d));
    const folio = limpiarFolio(s.deal?.parcelId);
    const ventas = folio
      ? (escrituras.get(folio) ?? []).filter((d) => d.fecha >= desde && d.monto >= MONTO_MINIMO_VENTA && delDemandado(d, "D"))
      : [];
    if (!liberacionesDelCaso.length && !ventas.length) continue;
    const cierre: Cierre = { caso, motivos: [] };
    if (liberacionesDelCaso.length) {
      const d = primero(liberacionesDelCaso);
      cierre.motivos.push("LIBERACION");
      cierre.liberacion = { instrumento: d.instrumento, fecha: aIso(d.fecha) };
    }
    if (ventas.length) {
      const d = primero(ventas);
      cierre.motivos.push("VENTA");
      cierre.venta = {
        instrumento: d.instrumento,
        fecha: aIso(d.fecha),
        monto: d.monto,
        compradores: partes(d, "R").map((p) => p.nombre),
      };
    }
    cierres.set(s.id, cierre);
  }
  return cierres;
}

export type ResultadoCierres = { revisadas: number; cerradas: number; porLiberacion: number; porVenta: number; dealIds: string[] };

/**
 * Guarda el cierre de cada senal CONFIRMED de broward-foreclosure que el indice trae y pasa esa senal a CLEARED.
 * Idempotente: una senal ya cerrada no vuelve a leerse. Devuelve los deals que cambiaron, para recalcular etapa y puntaje.
 */
export async function guardarCierres(
  prisma: Pick<PrismaClient, "dealDistressSignal">,
  ind: Indice,
): Promise<ResultadoCierres> {
  const resultado: ResultadoCierres = { revisadas: 0, cerradas: 0, porLiberacion: 0, porVenta: 0, dealIds: [] };
  const { liberaciones, escrituras } = hechosDelIndice(ind);
  if (!liberaciones.size && !escrituras.size) return resultado;
  const senales: SenalForeclosure[] = await prisma.dealDistressSignal.findMany({
    where: { source: FUENTE_FORECLOSURE, status: "CONFIRMED" },
    select: { id: true, dealId: true, externalId: true, metadata: true, observedAt: true, deal: { select: { parcelId: true } } },
  });
  resultado.revisadas = senales.length;
  const cierres = cierresDelIndice(ind, senales);
  const deals = new Set<string>();
  for (const s of senales) {
    const c = cierres.get(s.id);
    if (!c) continue;
    const metadata = JSON.stringify({ ...c, caseNumber: c.caso, fuente: "Official Records de Broward, indice diario (FTP del condado)" });
    const fecha = (c.liberacion ?? c.venta)!.fecha;
    await prisma.dealDistressSignal.upsert({
      where: { dealId_source_externalId: { dealId: s.dealId, source: FUENTE_CIERRE, externalId: c.caso } },
      update: { metadata, status: ESTADO_CERRADA },
      create: {
        dealId: s.dealId,
        source: FUENTE_CIERRE,
        externalId: c.caso,
        status: ESTADO_CERRADA,
        confidence: "HIGH",
        observedAt: new Date(`${fecha}T12:00:00Z`),
        metadata,
      },
    });
    await prisma.dealDistressSignal.update({ where: { id: s.id }, data: { status: ESTADO_CERRADA } });
    resultado.cerradas += 1;
    if (c.liberacion) resultado.porLiberacion += 1;
    if (c.venta) resultado.porVenta += 1;
    deals.add(s.dealId);
  }
  resultado.dealIds = [...deals];
  return resultado;
}
