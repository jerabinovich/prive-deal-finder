import type { PrismaClient } from "@prisma/client";
import { CAPA_CATASTRO_PUNTOS } from "./parcelas-estatales";
import { CAPA_PALM_BEACH } from "./parcelas-palm-beach";

/**
 * TASACION, ULTIMA VENTA Y LOTE DESDE EL CATASTRO ESTATAL (23-oct-2026, decision de JR).
 *
 * Que faltaba, medido el 23-oct: MdpaAssessment y MdpaSale tenian 0 filas (la fuente MDPA es paga y esta apagada), asi
 * que la alerta, los comparables y la ficha no tenian tasacion ni venta en ningun condado; y Broward no tenia lote.
 *
 * Fuente: el catastro del Departamento de Revenue (rol 2026), la misma capa de puntos de parcelas-estatales.ts. Se
 * consulta por condado y folio (PARCEL_ID IN, lotes de 200, 1 a 4 segundos por consulta); los folios de las cinco
 * fuentes de parcelas coinciden tal cual (medido en muestras de 50: 48 a 50 de 50).
 *
 * Valor y venta van separados: la tasacion (JV, AV_NSD, TV_NSD) a MdpaAssessment, la venta a MdpaSale. Solo se guardan
 * ventas con codigo de calificacion 01 (venta de mercado de una parcela). Los otros codigos de la muestra eran
 * transferencias de 100 dolares (11, 14, 98) o ventas de varias parcelas juntas (37 con mediana de 44 M, 05, 43), y
 * como "ultima venta" ensuciaban los comparables. El estado solo trae las dos ultimas ventas del anio del rol; Broward y
 * Palm Beach suman las suyas (VENTAS_DEL_CONDADO).
 *
 * El lote (LND_SQFOOT) solo llena un lote vacio: nunca pisa el del condado.
 */
export const CONDADO_POR_FUENTE: Record<string, number> = {
  "miami-dade-parcels": 23,
  "broward-parcels": 16,
  "palm-beach-parcels": 60,
  "monroe-parcels": 54,
  "martin-parcels": 53,
};

export const LIBRERIA_CATASTRO = "fdor-catastro";
export const FOLIOS_POR_CONSULTA = 200;
export const CODIGOS_DE_MERCADO = ["01"];

export type VentaCatastro = { saleDate: Date; salePrice: number; saleType: string };
export type ValoresCatastro = {
  parcelId: string;
  taxYear: number;
  justValue: number | null;
  assessedValue: number | null;
  taxableValue: number | null;
  lotSizeSqft: number | null;
  ventas: VentaCatastro[];
};

const positivo = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function valoresDeFila(a: Record<string, unknown>): ValoresCatastro | null {
  const parcelId = String(a.PARCEL_ID ?? "").trim();
  const taxYear = positivo(a.ASMNT_YR);
  if (!parcelId || !taxYear) return null;
  const ventas: VentaCatastro[] = [];
  for (const n of ["1", "2"]) {
    const precio = positivo(a[`SALE_PRC${n}`]);
    const anio = positivo(a[`SALE_YR${n}`]);
    const mes = positivo(a[`SALE_MO${n}`]);
    const codigo = String(a[`QUAL_CD${n}`] ?? "").trim();
    if (!precio || !anio || !mes || mes > 12 || !CODIGOS_DE_MERCADO.includes(codigo)) continue;
    ventas.push({ saleDate: new Date(Date.UTC(anio, mes - 1, 1)), salePrice: precio, saleType: `FDOR ${codigo}` });
  }
  return {
    parcelId,
    taxYear,
    justValue: positivo(a.JV),
    assessedValue: positivo(a.AV_NSD),
    taxableValue: positivo(a.TV_NSD),
    lotSizeSqft: positivo(a.LND_SQFOOT),
    ventas,
  };
}

export type Buscar = (url: string, where: string) => Promise<unknown[]>;

/**
 * Una consulta por POST sin orden ni paginacion: cada lote trae a lo sumo 200 filas. Con orderByFields y resultOffset
 * (fetchArcgisPagina) la capa rechazaba algunos lotes ("Invalid query parameters", medido el 23-oct en el lote 1200
 * de Miami-Dade); el mismo lote sin orden responde. Tope de 60 segundos por consulta (sin tope, una respuesta que
 * nunca llego colgo la corrida 30 minutos el 23-oct) y tres intentos antes de cortar.
 */
/**
 * LOTE CORTADO (25-oct-2026, cowork-pendientes-5oct, hallazgo 1 de la revision del PR 13). Una capa devuelve a lo sumo
 * maxRecordCount filas (BCPA_SALES: 1.000; el catastro estatal: 2.000) y lo avisa con exceededTransferLimit. Antes se
 * tomaba lo que vino como si fuera todo. Ahora consultaArcgis lo rechaza con LoteCortado, sin reintentar, y las
 * consultas por lotes de folios lo parten en dos hasta que entra; si un solo folio no entra, falla. Medido el 25-oct:
 * el lote mas grande de Broward trae 45 filas, asi que hoy no pasa.
 */
export class LoteCortado extends Error {
  constructor(url: string) {
    super(`ArcGIS corto la respuesta en su tope de filas (${url})`);
    this.name = "LoteCortado";
  }
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 25-oct-2026: espera 2 s y 4 s entre los tres intentos y ninguna despues del ultimo (antes sumaba 6 s antes de fallar). */
export async function consultaArcgis(
  url: string,
  parametros: Record<string, string>,
  esperar: (ms: number) => Promise<void> = dormir,
): Promise<unknown[]> {
  let ultimo: unknown;
  for (let intento = 1; intento <= 3; intento += 1) {
    try {
      const respuesta = await fetch(`${url.replace(/\/+$/, "")}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ outFields: "*", returnGeometry: "false", f: "json", ...parametros }).toString(),
        signal: AbortSignal.timeout(60_000),
      });
      if (!respuesta.ok) throw new Error(`ArcGIS ${respuesta.status}`);
      const cuerpo = (await respuesta.json()) as { error?: { message?: string }; features?: unknown[]; exceededTransferLimit?: boolean };
      if (cuerpo?.error) throw new Error(`ArcGIS: ${cuerpo.error.message ?? "sin detalle"}`);
      if (cuerpo?.exceededTransferLimit) throw new LoteCortado(url);
      return Array.isArray(cuerpo?.features) ? cuerpo.features : [];
    } catch (e) {
      if (e instanceof LoteCortado) throw e;
      ultimo = e;
      if (intento < 3) await esperar(2000 * intento);
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error(String(ultimo));
}

export const buscarEnCatastro: Buscar = (url, where) => consultaArcgis(url, { where });

/** Pide un lote de folios; si la capa lo corta (LoteCortado), lo parte en dos hasta que entra. */
async function buscarPartiendo(buscar: Buscar, url: string, folios: string[], armar: (lista: string) => string): Promise<unknown[]> {
  const lista = folios.map((f) => `'${f.replace(/'/g, "''")}'`).join(",");
  try {
    return await buscar(url, armar(lista));
  } catch (e) {
    if (!(e instanceof LoteCortado) || folios.length <= 1) throw e;
    const mitad = Math.ceil(folios.length / 2);
    const primera = await buscarPartiendo(buscar, url, folios.slice(0, mitad), armar);
    return [...primera, ...(await buscarPartiendo(buscar, url, folios.slice(mitad), armar))];
  }
}

export async function consultarCatastro(
  condado: number,
  folios: string[],
  buscar: Buscar = buscarEnCatastro,
  url = CAPA_CATASTRO_PUNTOS,
): Promise<Map<string, ValoresCatastro>> {
  const salida = new Map<string, ValoresCatastro>();
  for (let i = 0; i < folios.length; i += FOLIOS_POR_CONSULTA) {
    const filas = await buscarPartiendo(buscar, url, folios.slice(i, i + FOLIOS_POR_CONSULTA),
      (lista) => `CO_NO=${condado} AND PARCEL_ID IN (${lista})`);
    for (const fila of filas) {
      const v = valoresDeFila(((fila as { attributes?: Record<string, unknown> })?.attributes) ?? {});
      if (v) salida.set(v.parcelId, v);
    }
  }
  return salida;
}

type PrismaValores = Pick<PrismaClient, "mdpaAssessment" | "mdpaSale" | "deal">;

export async function aplicarValores(
  prisma: PrismaValores,
  deal: { id: string; lotSizeSqft: number | null },
  v: ValoresCatastro,
  snapshotId: string,
): Promise<{ tasacion: "nueva" | "actualizada"; ventasNuevas: number; lote: boolean }> {
  const valores = { justValue: v.justValue, assessedValue: v.assessedValue, taxableValue: v.taxableValue };
  const existente = await prisma.mdpaAssessment.findFirst({
    where: { dealId: deal.id, taxYear: v.taxYear, sourceSnapshotId: snapshotId },
    select: { id: true },
  });
  if (existente) {
    await prisma.mdpaAssessment.update({ where: { id: existente.id }, data: valores });
  } else {
    await prisma.mdpaAssessment.create({ data: { dealId: deal.id, taxYear: v.taxYear, ...valores, sourceSnapshotId: snapshotId } });
  }
  const ventasNuevas = await guardarVentas(prisma, deal.id, v.ventas, snapshotId);
  const lote = deal.lotSizeSqft === null && v.lotSizeSqft !== null;
  if (lote) await prisma.deal.update({ where: { id: deal.id }, data: { lotSizeSqft: v.lotSizeSqft } });
  return { tasacion: existente ? "actualizada" : "nueva", ventasNuevas, lote };
}

/**
 * Guarda las ventas que falten. Una venta con el mismo precio en el mismo mes ya esta: el estado da solo el mes y el
 * condado el dia exacto, y son la misma escritura.
 */
export async function guardarVentas(
  prisma: Pick<PrismaClient, "mdpaSale">,
  dealId: string,
  ventas: VentaCatastro[],
  snapshotId: string | null,
): Promise<number> {
  let nuevas = 0;
  for (const venta of ventas) {
    const d = venta.saleDate;
    const ya = await prisma.mdpaSale.findFirst({
      where: {
        dealId,
        salePrice: venta.salePrice,
        saleDate: { gte: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)), lt: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) },
      },
      select: { id: true },
    });
    if (ya) continue;
    await prisma.mdpaSale.create({ data: { dealId, ...venta, sourceSnapshotId: snapshotId } });
    nuevas += 1;
  }
  return nuevas;
}

const monto = (v: unknown) => positivo(String(v ?? "").replace(/[$,\s]/g, ""));
const fecha = (v: unknown) => {
  const n = positivo(v);
  return n ? new Date(n) : null;
};

/**
 * VENTAS DE LOS CONDADOS (23-oct). El estado solo trae las ventas del anio del rol; dos condados publican mas:
 *   Broward, BCPA_SALES (capa 37): ventas de 2023 a 2026, SALE_VER Q es calificada (107.598 de 108.732).
 *   Palm Beach, la capa de parcelas: la ultima venta con QUAL_CODE. Medido en 400 deals: Q mediana 1,3 M; D, DD y U
 *   son transferencias (mediana 10 dolares); QM, QC, QD y QO son variantes (varias parcelas y otras) que se dejan afuera
 *   como el 37 del estado.
 * Miami-Dade, Monroe y Martin no publican ventas gratis: solo las del estado.
 */
export function ventaBroward(a: Record<string, unknown>): VentaCatastro | null {
  const saleDate = fecha(a.SALE_DATE);
  const salePrice = monto(a.SALE_AMOUNT);
  if (!saleDate || !salePrice || String(a.SALE_VER ?? "").trim() !== "Q") return null;
  return { saleDate, salePrice, saleType: "BCPA Q" };
}

export function ventaPalmBeach(a: Record<string, unknown>): VentaCatastro | null {
  const saleDate = fecha(a.SALE_DATE);
  const salePrice = monto(a.PRICE);
  if (!saleDate || !salePrice || String(a.QUAL_CODE ?? "").trim() !== "Q") return null;
  return { saleDate, salePrice, saleType: "PAPA Q" };
}

export const VENTAS_DEL_CONDADO: Record<string, { url: string; campoFolio: string; venta: (a: Record<string, unknown>) => VentaCatastro | null }> = {
  "broward-parcels": {
    url: "https://gisweb-adapters.bcpa.net/arcgis/rest/services/BCPA_EXTERNAL_JAN26/MapServer/37",
    campoFolio: "FOLIO_NUMBER",
    venta: ventaBroward,
  },
  "palm-beach-parcels": { url: CAPA_PALM_BEACH, campoFolio: "PARCEL_NUMBER", venta: ventaPalmBeach },
};

export async function consultarVentasDelCondado(
  fuente: string,
  folios: string[],
  buscar: Buscar = buscarEnCatastro,
): Promise<Map<string, VentaCatastro[]>> {
  const cfg = VENTAS_DEL_CONDADO[fuente];
  const salida = new Map<string, VentaCatastro[]>();
  if (!cfg) return salida;
  for (let i = 0; i < folios.length; i += FOLIOS_POR_CONSULTA) {
    const filas = await buscarPartiendo(buscar, cfg.url, folios.slice(i, i + FOLIOS_POR_CONSULTA),
      (lista) => `${cfg.campoFolio} IN (${lista})`);
    for (const fila of filas) {
      const a = ((fila as { attributes?: Record<string, unknown> })?.attributes) ?? {};
      const folio = String(a[cfg.campoFolio] ?? "").trim();
      const venta = cfg.venta(a);
      if (!folio || !venta) continue;
      salida.set(folio, [...(salida.get(folio) ?? []), venta]);
    }
  }
  return salida;
}

export type ResumenCatastro = {
  fuente: string; deals: number; encontrados: number; tasaciones: number; ventas: number; ventasCondado: number; lotes: number;
};

/**
 * Recorre los deals de parcelas que todavia no tienen tasacion del catastro (o todos, con `todos`) y les carga
 * tasacion, ventas de mercado y lote. Sin `aplicar` solo cuenta lo que encontraria.
 */
export async function enriquecerConCatastro(
  prisma: PrismaClient,
  opciones: { aplicar: boolean; todos?: boolean; fuentes?: string[]; limite?: number; buscar?: Buscar; log?: (m: string) => void },
): Promise<ResumenCatastro[]> {
  const log = opciones.log ?? (() => undefined);
  const resumenes: ResumenCatastro[] = [];
  const snapshots = new Map<number, string>();
  const snapshotDe = async (anio: number) => {
    const fileName = `Florida_Statewide_Parcel_Centroid_Version ${anio}`;
    if (!snapshots.has(anio)) {
      const ya = await prisma.mdpaDatasetSnapshot.findFirst({ where: { library: LIBRERIA_CATASTRO, fileName } });
      const s = ya ?? (await prisma.mdpaDatasetSnapshot.create({
        data: { library: LIBRERIA_CATASTRO, fileName, snapshotDate: new Date(), sourceUrl: CAPA_CATASTRO_PUNTOS },
      }));
      snapshots.set(anio, s.id);
    }
    return snapshots.get(anio)!;
  };
  for (const [fuente, condado] of Object.entries(CONDADO_POR_FUENTE)) {
    if (opciones.fuentes?.length && !opciones.fuentes.includes(fuente)) continue;
    const deals = await prisma.deal.findMany({
      where: {
        source: fuente,
        parcelId: { not: null },
        ...(opciones.todos ? {} : { assessments: { none: { sourceSnapshot: { library: LIBRERIA_CATASTRO } } } }),
      },
      select: { id: true, parcelId: true, lotSizeSqft: true },
      orderBy: { createdAt: "asc" },
      ...(opciones.limite ? { take: opciones.limite } : {}),
    });
    const resumen: ResumenCatastro = { fuente, deals: deals.length, encontrados: 0, tasaciones: 0, ventas: 0, ventasCondado: 0, lotes: 0 };
    const valores = await consultarCatastro(condado, deals.map((d) => d.parcelId as string), opciones.buscar);
    for (const deal of deals) {
      const v = valores.get(deal.parcelId as string);
      if (!v) continue;
      resumen.encontrados += 1;
      if (!opciones.aplicar) {
        resumen.tasaciones += 1;
        resumen.ventas += v.ventas.length;
        if (deal.lotSizeSqft === null && v.lotSizeSqft !== null) resumen.lotes += 1;
        continue;
      }
      const r = await aplicarValores(prisma, deal, v, await snapshotDe(v.taxYear));
      resumen.tasaciones += 1;
      resumen.ventas += r.ventasNuevas;
      if (r.lote) resumen.lotes += 1;
    }
    if (VENTAS_DEL_CONDADO[fuente]) {
      const ventas = await consultarVentasDelCondado(fuente, deals.map((d) => d.parcelId as string), opciones.buscar);
      for (const deal of deals) {
        const lista = ventas.get(deal.parcelId as string) ?? [];
        if (!lista.length) continue;
        resumen.ventasCondado += opciones.aplicar ? await guardarVentas(prisma, deal.id, lista, null) : lista.length;
      }
    }
    log(`${fuente}: ${JSON.stringify(resumen)}`);
    resumenes.push(resumen);
  }
  return resumenes;
}
