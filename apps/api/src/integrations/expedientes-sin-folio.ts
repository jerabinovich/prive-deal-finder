import { PrismaService } from "../shared/prisma.service";
import { normalizarCaso } from "./registro-oficial-broward";

/**
 * 31-oct-2026: los expedientes de Broward que no se pudieron atar a un folio.
 *
 * POR QUE: desde el PR 23 cada fecha de presentacion se consulta una sola vez (una consulta paga por dia habil), asi
 * que un expediente que no resolvio no vuelve solo. Quedan en Integration.meta.expedientesSinFolio, sin tocar el
 * resto de meta. Cada corrida vuelve a probar la cadena de Official Records (registro-oficial-broward.ts) con los que
 * todavia pueden resolver: los que no tenian el lis pendens en el FTP, que se registra uno o dos dias despues de la
 * demanda y el FTP va uno o dos dias atrasado, y los que fallaron por un error del FTP. No repite la busqueda por
 * nombre ni gasta unidades del Clerk. El resto (sin hipoteca enlazada, deudor distinto, refinanciamiento) queda a la
 * vista como lista para revisar a mano. Se reintenta hasta 14 dias y se ve hasta 30.
 */
export const CLAVE_SIN_FOLIO = "expedientesSinFolio";
export const DIAS_DE_REINTENTO = 14;
export const DIAS_A_LA_VISTA = 30;
export const MAX_SIN_FOLIO = 200;
/** Marca de la corrida: el expediente vuelve de la lista y no repite la busqueda por nombre. No se guarda. */
export const MARCA_REINTENTO = "reintentoSinFolio";
const REINTENTABLES = new Set(["SIN_LIS_PENDENS", "ERROR", "SIN_INTENTO"]);
const CAMPOS_DE_LA_CORRIDA = ["parcelId", "parcelIds", "registroOficial", "subdivision", MARCA_REINTENTO];

export type ExpedienteSinFolio = {
  caso: string;
  desde: string;
  intentos: number;
  ultimoEstado: string;
  registro: Record<string, unknown>;
};

type Registro = Record<string, unknown>;

export const casoDelRegistro = (r: Registro) => normalizarCaso(String(r.caseNumber ?? r.Case_Number ?? ""));
export const tieneFolio = (r: Registro) => Array.isArray(r.parcelIds) && r.parcelIds.length > 0;

export function estadoRegistroOficial(r: Registro): string {
  const ro = r.registroOficial as { estado?: unknown } | undefined;
  return typeof ro?.estado === "string" ? ro.estado : "SIN_INTENTO";
}

/** El registro tal como vino del Clerk, con su resolucion por nombre, sin lo que agrega cada corrida. */
export function registroLimpio(r: Registro): Registro {
  const copia: Registro = { ...r };
  for (const k of CAMPOS_DE_LA_CORRIDA) delete copia[k];
  return copia;
}

const dia = (d: Date) => d.toISOString().slice(0, 10);
const diasDesde = (desde: string, hoy: Date) => Math.floor((Date.parse(dia(hoy)) - Date.parse(desde)) / 86_400_000);

function leerMeta(texto?: string | null): Record<string, unknown> {
  try {
    const m = JSON.parse(texto || "{}");
    return m && typeof m === "object" && !Array.isArray(m) ? (m as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function esExpediente(x: unknown): x is ExpedienteSinFolio {
  const e = x as ExpedienteSinFolio;
  return Boolean(e) && typeof e.caso === "string" && typeof e.desde === "string" && Boolean(e.registro) && typeof e.registro === "object";
}

export async function leerSinFolio(prisma: PrismaService, source: string): Promise<ExpedienteSinFolio[]> {
  const fila = await prisma.integration.findUnique({ where: { source }, select: { meta: true } });
  const lista = leerMeta(fila?.meta)[CLAVE_SIN_FOLIO];
  return Array.isArray(lista) ? lista.filter(esExpediente) : [];
}

/** Guarda la lista sin pisar el resto de Integration.meta (estado del conector, cursor). */
export async function guardarSinFolio(prisma: PrismaService, source: string, lista: ExpedienteSinFolio[]): Promise<void> {
  const fila = await prisma.integration.findUnique({ where: { source }, select: { meta: true } });
  const meta = { ...leerMeta(fila?.meta), [CLAVE_SIN_FOLIO]: lista };
  await prisma.integration.upsert({
    where: { source },
    update: { meta: JSON.stringify(meta) },
    create: { source, meta: JSON.stringify(meta) },
  });
}

/** Los que vale la pena volver a probar hoy, listos para la siembra y marcados para no repetir el nombre. */
export function paraReintentar(lista: ExpedienteSinFolio[], hoy: Date): Registro[] {
  return lista
    .filter((e) => REINTENTABLES.has(e.ultimoEstado) && diasDesde(e.desde, hoy) <= DIAS_DE_REINTENTO)
    .map((e) => ({ ...e.registro, [MARCA_REINTENTO]: true }));
}

/** La lista despues de la corrida: suma los que quedaron sin folio, saca los resueltos y los vencidos. */
export function actualizarSinFolio(
  anteriores: ExpedienteSinFolio[],
  registros: Registro[],
  hoy: Date,
): { lista: ExpedienteSinFolio[]; nuevos: number; resueltos: number; vencidos: number } {
  const previos = new Map(anteriores.map((e) => [e.caso, e]));
  const vistos = new Set<string>();
  const lista: ExpedienteSinFolio[] = [];
  let nuevos = 0;
  let resueltos = 0;
  for (const r of registros) {
    const caso = casoDelRegistro(r);
    if (!caso || vistos.has(caso)) continue;
    vistos.add(caso);
    const previo = previos.get(caso);
    if (tieneFolio(r)) {
      if (previo) resueltos += 1;
      continue;
    }
    if (!previo) nuevos += 1;
    lista.push({
      caso,
      desde: previo?.desde ?? dia(hoy),
      intentos: (previo?.intentos ?? 0) + 1,
      ultimoEstado: estadoRegistroOficial(r),
      registro: registroLimpio(r),
    });
  }
  // Los que hoy no se reintentaron quedan como estaban, a la vista hasta vencer.
  for (const e of anteriores) if (!vistos.has(e.caso)) lista.push(e);
  const vigentes = lista.filter((e) => diasDesde(e.desde, hoy) <= DIAS_A_LA_VISTA);
  vigentes.sort((a, b) => b.desde.localeCompare(a.desde));
  const recorte = vigentes.slice(0, MAX_SIN_FOLIO);
  return { lista: recorte, nuevos, resueltos, vencidos: lista.length - recorte.length };
}
