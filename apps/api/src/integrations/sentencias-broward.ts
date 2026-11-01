import type { PrismaClient } from "@prisma/client";
import { FUENTE_SENTENCIA } from "../deals/distress-classification";
import { normalizarCaso, type Indice } from "./registro-oficial-broward";

/**
 * SENTENCIA FINAL COMO REMATE (1-nov-2026, JR: "arranca remates"; decision 6 del estudio de remates publicos).
 *
 * La ley fija el remate entre 20 y 35 dias despues de la sentencia final (s. 45.031, F.S.). El indice diario de
 * Official Records de Broward (el FTP gratis del condado, registro-oficial-broward.ts) trae cada sentencia con su
 * numero de caso. Si el caso ya es una senal de broward-foreclosure de un deal, la sentencia entra como senal propia
 * de ese deal (FUENTE_SENTENCIA) y decidirDistress sube la etapa a AUCTION_SCHEDULED, solo si ese foreclosure cumple
 * el criterio de JR. El calendario exacto del remate sigue en RealForeclose, que no se lee por script.
 *
 * POR QUE UNA SENAL APARTE y no un campo dentro de la del foreclosure: la ingesta reescribe la metadata de esa senal
 * cada vez que el caso vuelve del Clerk, y la sentencia se perderia.
 *
 * SOLO FJ: es el codigo de la sentencia final en los archivos reales (unas 270 por dia, todas con numero de caso).
 * FJX, CFJ y CFJX tambien traen caso, pero su descripcion no esta verificada contra la tabla de tipos del condado:
 * se suman cuando se confirme. Sin la tabla no se adivina.
 */
export const TIPOS_SENTENCIA = new Set(["FJ"]);
export const DIAS_REMATE_DESDE = 20;
export const DIAS_REMATE_HASTA = 35;
const FUENTE_FORECLOSURE = "broward-foreclosure";

export type Sentencia = { caso: string; instrumento: string; tipo: string; fecha: string };

/** La sentencia mas reciente de cada caso en la ventana: una sentencia enmendada vuelve a fijar el remate. */
export function sentenciasDelIndice(ind: Indice): Map<string, Sentencia> {
  const porCaso = new Map<string, Sentencia>();
  for (const d of ind.docs.values()) {
    if (!TIPOS_SENTENCIA.has(d.tipo)) continue;
    const caso = normalizarCaso(d.caso);
    if (!caso || !/^\d{8}$/.test(d.fecha)) continue;
    const previa = porCaso.get(caso);
    if (previa && (previa.fecha > d.fecha || (previa.fecha === d.fecha && previa.instrumento >= d.instrumento))) continue;
    porCaso.set(caso, { caso, instrumento: d.instrumento, tipo: d.tipo, fecha: d.fecha });
  }
  return porCaso;
}

const aIso = (aaaammdd: string) => `${aaaammdd.slice(0, 4)}-${aaaammdd.slice(4, 6)}-${aaaammdd.slice(6, 8)}`;
const masDias = (iso: string, dias: number) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10);

/** La ventana del remate segun s. 45.031: de 20 a 35 dias despues de la sentencia. Fechas AAAA-MM-DD. */
export function ventanaDelRemate(fecha: string) {
  const registro = aIso(fecha);
  return { registro, desde: masDias(registro, DIAS_REMATE_DESDE), hasta: masDias(registro, DIAS_REMATE_HASTA) };
}

export type ResultadoSentencias = { enVentana: number; conSenal: number; nuevas: number; dealIds: string[] };

/**
 * Guarda como senal FUENTE_SENTENCIA cada sentencia cuyo caso ya es una senal de broward-foreclosure. Idempotente: la
 * misma sentencia no se vuelve a escribir. Devuelve los deals que cambiaron, para recalcular su etapa y su puntaje.
 */
export async function guardarSentencias(
  prisma: Pick<PrismaClient, "dealDistressSignal">,
  sentencias: Map<string, Sentencia>,
): Promise<ResultadoSentencias> {
  const resultado: ResultadoSentencias = { enVentana: sentencias.size, conSenal: 0, nuevas: 0, dealIds: [] };
  if (!sentencias.size) return resultado;
  const senales = await prisma.dealDistressSignal.findMany({
    where: { source: FUENTE_FORECLOSURE, externalId: { in: [...sentencias.keys()] } },
    select: { dealId: true, externalId: true },
  });
  const deals = new Set<string>();
  for (const s of senales) {
    const st = s.externalId ? sentencias.get(s.externalId) : undefined;
    if (!st) continue;
    resultado.conSenal += 1;
    const v = ventanaDelRemate(st.fecha);
    const metadata = JSON.stringify({
      caseNumber: st.caso,
      instrumento: st.instrumento,
      tipo: st.tipo,
      fechaRegistro: v.registro,
      remateDesde: v.desde,
      remateHasta: v.hasta,
      fuente: "Official Records de Broward, indice diario (FTP del condado)",
    });
    const where = { dealId_source_externalId: { dealId: s.dealId, source: FUENTE_SENTENCIA, externalId: st.caso } };
    const previa = await prisma.dealDistressSignal.findUnique({ where, select: { metadata: true } });
    if (previa?.metadata === metadata) continue;
    const observedAt = new Date(`${v.registro}T12:00:00Z`);
    await prisma.dealDistressSignal.upsert({
      where,
      update: { metadata, observedAt },
      create: {
        dealId: s.dealId,
        source: FUENTE_SENTENCIA,
        externalId: st.caso,
        status: "CONFIRMED",
        confidence: "HIGH",
        observedAt,
        metadata,
      },
    });
    resultado.nuevas += 1;
    deals.add(s.dealId);
  }
  resultado.dealIds = [...deals];
  return resultado;
}
