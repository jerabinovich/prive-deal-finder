import { readFileSync } from "fs";
import { fetchArcgisPagina } from "./arcgis-pagina";
import { formatearDomicilioEstatal } from "./domicilio-postal";
import { CursorParcelas, RUTA_BUYBOX_POR_DEFECTO, claveConsulta } from "./parcelas-corredores";

/**
 * MARTIN Y MONROE POR EL CATASTRO ESTATAL (15-oct-2026).
 *
 * POR QUE ESTA CAPA. Los servidores de los dos condados (geoweb.martin.fl.us y mcgis4.monroecounty-fl.gov) mandan
 * un certificado sin la cadena intermedia: ni curl ni Node los validan, y apagar la verificacion no va. El catastro
 * estatal del Departamento de Revenue (rol 2026, el mismo que ya usa domicilio-postal.ts) tiene dueno, domicilio
 * postal, uso DOR, valor y sitio para todo el estado. La version de poligonos tarda 45 a 55 segundos por consulta
 * filtrada y se corta (medido el 15 oct); la de puntos responde en 1 a 4 segundos si la consulta va por tramos de
 * OBJECTID. Por eso el recorrido va por tramos de 2000 OBJECTID del condado, con el condado y los zips de los
 * corredores en el WHERE, y el municipio y el uso del buy box se filtran aca.
 *
 * MUNICIPIO. PHY_CITY es la ciudad del sitio. En Martin, "JUPITER" es la ciudad postal de parcelas no incorporadas
 * (el pueblo de Jupiter esta en Palm Beach): por eso cada condado declara que municipios de los corredores tiene, y
 * uno que no declara no cuenta aunque el nombre coincida. Ocean Reef y Key West: decision de JR del 15 oct, Ocean
 * Reef solo (no todo North Key Largo) y Key West la ciudad entera (Old Town no se distingue en estos datos).
 */
export const CAPA_CATASTRO_PUNTOS =
  "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Parcel_Centroid_Version/FeatureServer/0";

export type CondadoEstatal = {
  source: string;
  nombre: string;
  /** CO_NO del Departamento de Revenue. */
  condado: number;
  market: string;
  /** Municipios de los corredores que estan en este condado, normalizados (solo letras, mayusculas). */
  localidades: string[];
};

export const CONDADOS_ESTATALES: CondadoEstatal[] = [
  { source: "martin-parcels", nombre: "Martin", condado: 53, market: "Martin", localidades: ["JUPITERISLAND"] },
  { source: "monroe-parcels", nombre: "Monroe", condado: 54, market: "Monroe", localidades: ["KEYWEST", "OCEANREEF"] },
];

/** Tramo de OBJECTID por consulta: es el maximo de filas por pagina de la capa. */
export const TRAMO = 2000;
/** Tope de tiempo por corrida: el sync de la manana corre las fuentes en fila y espera cada respuesta. */
export const PRESUPUESTO_MS = 100_000;

export const normalizarNombre = (t: unknown) => String(t ?? "").toUpperCase().replace(/[^A-Z]/g, "");

export type CorredorEstatal = { nombre: string; zips: string[]; municipios: string[] };

/** Los corredores de buybox.json con zips de Florida, con sus municipios normalizados. */
export function corredoresEstatales(ruta = process.env.BUYBOX_JSON || RUTA_BUYBOX_POR_DEFECTO): CorredorEstatal[] {
  const bb = JSON.parse(readFileSync(ruta, "utf-8")) as { corredores_tier1?: Record<string, unknown> };
  const salida: CorredorEstatal[] = [];
  for (const [nombre, corredor] of Object.entries(bb.corredores_tier1 ?? {})) {
    if (nombre.startsWith("_") || !corredor || typeof corredor !== "object") continue;
    const c = corredor as { zips?: unknown[]; municipios?: unknown[] };
    const zips = (c.zips ?? []).map((z) => String(z ?? "").trim()).filter((z) => /^3[234]\d{3}$/.test(z));
    if (!zips.length) continue;
    salida.push({ nombre, zips, municipios: (c.municipios ?? []).map(normalizarNombre).filter(Boolean) });
  }
  if (!salida.length) throw new Error(`buybox.json sin corredores de Florida (${ruta})`);
  return salida;
}

/** Usos del buy box por codigo DOR, igual que Miami-Dade y Broward: 00, 03, 08, 10 a 49, 80 y 86 a 89. */
export function usoDelBuyBox(dorUc: unknown): boolean {
  const texto = String(dorUc ?? "").trim();
  if (!/^\d{1,4}$/.test(texto)) return false;
  const n = Number(texto) % 100;
  return n === 0 || n === 3 || n === 8 || n === 80 || (n >= 86 && n <= 89) || (n >= 10 && n <= 49);
}

export function zipDelSitio(v: unknown): string | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 30000 && n <= 34999 ? String(n) : null;
}

/** El corredor de la fila: su zip esta en un corredor y, si el corredor nombra municipios, la ciudad del sitio es uno de los de este condado. */
export function corredorDe(atributos: Record<string, unknown>, cfg: CondadoEstatal, corredores: CorredorEstatal[]): string | null {
  const zip = zipDelSitio(atributos.PHY_ZIPCD);
  if (!zip) return null;
  const ciudad = normalizarNombre(atributos.PHY_CITY);
  for (const c of corredores) {
    if (!c.zips.includes(zip)) continue;
    if (!c.municipios.length) return c.nombre;
    if (c.municipios.includes(ciudad) && cfg.localidades.includes(ciudad)) return c.nombre;
  }
  return null;
}

export function zipsDeLosCorredores(corredores: CorredorEstatal[]): string[] {
  return [...new Set(corredores.flatMap((c) => c.zips))].sort();
}

export function whereTramo(cfg: CondadoEstatal, desde: number, zips: string[]): string {
  return `CO_NO = ${cfg.condado} AND OBJECTID >= ${desde} AND OBJECTID < ${desde + TRAMO} AND PHY_ZIPCD IN (${zips.join(",")})`;
}

const SIN_DIRECCION = new Set(["", "UNASSIGNED", "VACANT LAND", "VACANT", "NO SITUS", "NONE"]);

function limpio(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).replace(/\s+/g, " ").trim();
}

function positivo(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

type Fila = { attributes?: Record<string, unknown>; geometry?: { x?: number; y?: number } };

/**
 * Una fila del catastro con los nombres que lee la ingesta (arcgis.ingest.ts): direccion, ciudad y zip del sitio,
 * dueno, domicilio postal, uso como codigo DOR de 2 cifras (lo traduce resolveDorUseCode, como en Broward), superficie,
 * construccion, ano y valor justo. Los ceros del rol (sin construccion, sin ano) quedan vacios.
 */
export function normalizarRegistroEstatal(fila: unknown): { attributes: Record<string, unknown>; geometry?: { x: number; y: number } } {
  const r = (fila || {}) as Fila;
  const a = r.attributes ?? {};
  const linea1 = limpio(a.PHY_ADDR1);
  const linea2 = limpio(a.PHY_ADDR2);
  const direccion = SIN_DIRECCION.has(linea1.toUpperCase()) ? "" : [linea1, linea2].filter(Boolean).join(" ");
  const ciudad = limpio(a.PHY_CITY).toUpperCase();
  const dor = limpio(a.DOR_UC);
  const atributos: Record<string, unknown> = {
    PARCEL_ID: limpio(a.PARCEL_ID),
    ALT_KEY: limpio(a.ALT_KEY) || undefined,
    CO_NO: a.CO_NO,
    ASMNT_YR: a.ASMNT_YR,
    DOR_UC: dor,
    USE_CODE: /^\d{1,4}$/.test(dor) ? String(Number(dor) % 100).padStart(2, "0") : undefined,
    SITUS_ADDRESS: direccion || undefined,
    SITUS_CITY: ciudad || undefined,
    MUNICIPALITY: ciudad || undefined,
    SITUS_ZIP: zipDelSitio(a.PHY_ZIPCD) ?? undefined,
    SITUS_STATE: "FL",
    OWN_NAME: limpio(a.OWN_NAME) || undefined,
    MAILING_ADDRESS: formatearDomicilioEstatal(a),
    LAND_SQFT: positivo(a.LND_SQFOOT),
    TOT_LVG_AREA: positivo(a.TOT_LVG_AR),
    ACT_YR_BLT: positivo(a.ACT_YR_BLT),
    JUST_VALUE: positivo(a.JV),
    NO_RES_UNT: positivo(a.NO_RES_UNT),
  };
  for (const k of Object.keys(atributos)) if (atributos[k] === undefined) delete atributos[k];
  const x = Number(r.geometry?.x);
  const y = Number(r.geometry?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { attributes: atributos, geometry: { x, y } } : { attributes: atributos };
}

export type RangoCondado = { lo: number; hi: number; n: number };

/** Primer y ultimo OBJECTID del condado en la capa. La capa se recarga una vez al ano y los OBJECTID cambian. */
export async function rangoDelCondado(cfg: CondadoEstatal, url = CAPA_CATASTRO_PUNTOS): Promise<RangoCondado> {
  const parametros = new URLSearchParams({
    where: `CO_NO = ${cfg.condado}`,
    f: "json",
    outStatistics: JSON.stringify([
      { statisticType: "min", onStatisticField: "OBJECTID", outStatisticFieldName: "lo" },
      { statisticType: "max", onStatisticField: "OBJECTID", outStatisticFieldName: "hi" },
      { statisticType: "count", onStatisticField: "OBJECTID", outStatisticFieldName: "n" },
    ]),
  });
  const respuesta = await fetch(`${url.replace(/\/+$/, "")}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: parametros.toString(),
  });
  if (!respuesta.ok) throw new Error(`ArcGIS statistics failed ${respuesta.status}`);
  const cuerpo = (await respuesta.json()) as { error?: { message?: string }; features?: Array<{ attributes?: Record<string, unknown> }> };
  if (cuerpo?.error) throw new Error(`ArcGIS statistics error: ${cuerpo.error.message ?? "sin detalle"}`);
  const a = cuerpo.features?.[0]?.attributes ?? {};
  const lo = Number(a.lo);
  const hi = Number(a.hi);
  const n = Number(a.n);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(n > 0) || hi < lo) throw new Error(`el condado ${cfg.condado} no tiene filas en la capa`);
  return { lo, hi, n };
}

/** Un tramo, con un reintento: la capa a veces devuelve 504 en una consulta suelta y la siguiente sale bien. */
async function tramoConReintento(url: string, where: string, esperaMs: number): Promise<unknown[]> {
  const pedir = () => fetchArcgisPagina(url, where, { offset: 0, cantidad: TRAMO, orden: "OBJECTID" });
  try {
    return await pedir();
  } catch {
    await new Promise((listo) => setTimeout(listo, esperaMs));
    return pedir();
  }
}

export type ResultadoRecorrido = {
  records: Array<{ attributes: Record<string, unknown>; geometry?: { x: number; y: number } }>;
  /** Primer OBJECTID leido en esta corrida. */
  desde: number;
  leidos: number;
  fueraDelCorredor: number;
  fueraDelBuyBox: number;
  repetidas: number;
  tramos: number;
  /** La vuelta del recorrido en la que corrio esta pagina. */
  vuelta: number;
  cursor: CursorParcelas;
  porCorredor: Record<string, number>;
};

/**
 * Una corrida del recorrido: tramos de OBJECTID desde el cursor hasta juntar `cantidad` parcelas del buy box en los
 * corredores, llegar al final del condado o agotar el tiempo. El cursor queda en el OBJECTID siguiente a la ultima
 * fila tomada, asi una corrida que corta a mitad de tramo sigue exactamente ahi. Al final del condado, la proxima
 * corrida empieza de nuevo y suma una vuelta. Si cambian los corredores o el rango del condado (recarga anual de la
 * capa), la clave cambia y el recorrido empieza de cero.
 */
export async function recorrerCondado(
  cfg: CondadoEstatal,
  cursor: CursorParcelas | null | undefined,
  opciones: {
    cantidad: number;
    url?: string;
    rango?: RangoCondado;
    ruta?: string;
    presupuestoMs?: number;
    reloj?: () => number;
    esperaMs?: number;
  },
): Promise<ResultadoRecorrido> {
  const url = opciones.url ?? CAPA_CATASTRO_PUNTOS;
  const reloj = opciones.reloj ?? Date.now;
  const presupuesto = opciones.presupuestoMs ?? PRESUPUESTO_MS;
  const corredores = corredoresEstatales(opciones.ruta);
  const zips = zipsDeLosCorredores(corredores);
  const rango = opciones.rango ?? (await rangoDelCondado(cfg, url));
  const clave = claveConsulta(url, `${whereTramo(cfg, 0, zips)}|${cfg.localidades.join(",")}|${JSON.stringify(corredores)}|${rango.lo}-${rango.hi}`);
  const mismo = cursor && cursor.clave === clave;
  let vueltas = mismo ? Math.max(0, Math.floor(Number(cursor.vueltas) || 0)) : 0;
  let pos = mismo ? Math.floor(Number(cursor.offset) || 0) : rango.lo;
  if (pos < rango.lo) pos = rango.lo;
  if (pos > rango.hi) {
    pos = rango.lo;
    vueltas += 1;
  }
  const desde = pos;
  const inicio = reloj();
  const records: ResultadoRecorrido["records"] = [];
  const vistos = new Set<string>();
  const porCorredor: Record<string, number> = {};
  let leidos = 0;
  let fueraDelCorredor = 0;
  let fueraDelBuyBox = 0;
  let repetidas = 0;
  let tramos = 0;
  let completo = false;
  // 31-oct-2026: una corrida que empezo pasado el principio y llega al final con lugar para mas sigue desde el
  // principio, hasta donde empezo. Antes devolvia lo que hubiera en la cola, aunque fuera nada: el 27 oct el tope de
  // tiempo dejo a Martin en su ultimo tramo, sin parcelas del buy box, y el 28 la corrida vino vacia y el aviso por
  // fuente lo marco como falla. Como en Palm Beach, que vuelve al principio en la misma corrida.
  let dioLaVuelta = false;
  while (pos <= rango.hi && records.length < opciones.cantidad) {
    if (tramos > 0 && reloj() - inicio > presupuesto) break;
    const filas = (await tramoConReintento(url, whereTramo(cfg, pos, zips), opciones.esperaMs ?? 3000)) as Fila[];
    tramos += 1;
    let siguiente = pos + TRAMO;
    for (const fila of filas) {
      const a = fila.attributes ?? {};
      leidos += 1;
      const nombreCorredor = corredorDe(a, cfg, corredores);
      if (!nombreCorredor) {
        fueraDelCorredor += 1;
      } else if (!usoDelBuyBox(a.DOR_UC)) {
        fueraDelBuyBox += 1;
      } else {
        const folio = limpio(a.PARCEL_ID);
        if (!folio || vistos.has(folio)) {
          repetidas += 1;
        } else {
          vistos.add(folio);
          records.push(normalizarRegistroEstatal(fila));
          porCorredor[nombreCorredor] = (porCorredor[nombreCorredor] ?? 0) + 1;
        }
      }
      if (records.length >= opciones.cantidad) {
        const oid = Number(a.OBJECTID);
        // Corta a mitad de tramo: la proxima corrida sigue en la fila siguiente a la ultima tomada.
        if (Number.isFinite(oid)) siguiente = oid + 1;
        break;
      }
    }
    pos = siguiente;
    if (pos > rango.hi) {
      if (!dioLaVuelta && desde > rango.lo && records.length < opciones.cantidad) {
        pos = rango.lo;
        vueltas += 1;
        dioLaVuelta = true;
      } else {
        completo = true;
      }
    }
    if (dioLaVuelta && pos >= desde) break;
  }
  const proximo: CursorParcelas = completo
    ? { clave, offset: rango.lo, vueltas: vueltas + 1, actualizado: new Date().toISOString() }
    : { clave, offset: pos, vueltas, actualizado: new Date().toISOString() };
  return { records, desde, leidos, fueraDelCorredor, fueraDelBuyBox, repetidas, tramos, vuelta: vueltas, cursor: proximo, porCorredor };
}
