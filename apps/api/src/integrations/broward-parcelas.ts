import { ciudadBroward } from "./ciudades-broward";
import { fetchArcgisWhere } from "./connectors/arcgis";

/**
 * UBICACION DE LAS PARCELAS DE BROWARD (13-oct-2026).
 *
 * La tabla del Property Appraiser (BCPA_INFO, la de BROWARD_PARCELS_URL) no trae geometria y guarda la
 * ciudad del sitio como codigo de dos letras. Medido el 13-oct: los 176 deals de Broward estaban sin
 * coordenadas, con la ciudad en "FL", "BC" o "PA", y 26 sin zip porque la capa decia "0".
 *
 * El mismo servicio publica la capa Parcels, con el poligono de cada folio. De ahi salen las coordenadas;
 * con las coordenadas, ingestArcgisRecords saca el zip del sitio por ZCTA del Census; y la ciudad sale del
 * mapa medido en ciudades-broward.ts. Las unidades de condominio no tienen poligono propio: el edificio
 * esta bajo el folio maestro, el mismo con las ultimas cuatro cifras en 0000.
 */

export type UbicacionParcela = { x: number; y: number; fuente: "PARCELA" | "CONDOMINIO" };

const capas = new Map<string, string>();

/** Una capa del mismo servicio, buscada por nombre exacto. null si no esta o si el servicio no responde. */
async function capaDelServicio(urlTabla: string, nombre: string): Promise<string | null> {
  const base = urlTabla.replace(/\/+$/, "").replace(/\/\d+$/, "");
  const clave = `${base}|${nombre}`;
  const guardada = capas.get(clave);
  if (guardada) return guardada;
  try {
    const respuesta = await fetch(`${base}?f=json`);
    if (!respuesta.ok) return null;
    const cuerpo = (await respuesta.json()) as { layers?: Array<{ id?: number; name?: string }> };
    const capa = (cuerpo.layers ?? []).find((l) => String(l.name ?? "").trim().toUpperCase() === nombre.toUpperCase());
    if (!capa || typeof capa.id !== "number") return null;
    const url = `${base}/${capa.id}`;
    capas.set(clave, url);
    return url;
  } catch {
    return null;
  }
}

/** La capa de poligonos del mismo servicio, buscada por nombre. null si no esta o si el servicio no responde. */
export function capaPoligonosBroward(urlTabla: string): Promise<string | null> {
  return capaDelServicio(urlTabla, "Parcels");
}

/**
 * Nombre de la subdivision o del condominio de cada folio (capa "Subdiv. Name", campo LEGAL_LINE; la llave
 * son las primeras 8 posiciones del folio). Sirve para reconocer a un consorcio que demanda sin decir
 * "association" en el nombre: "Chapel Trail Trade Center Inc" en el condominio CHAPEL TRAIL TRADE CENTER.
 * Un lote que falla deja esos folios sin nombre.
 */
export async function subdivisionesBroward(urlTabla: string, folios: string[]): Promise<Map<string, string>> {
  const salida = new Map<string, string>();
  const capa = await capaDelServicio(urlTabla, "Subdiv. Name");
  if (!capa) return salida;
  const porSub = new Map<string, string>();
  const subs = [...new Set(folios.map((f) => String(f ?? "").trim().toUpperCase().slice(0, 8)).filter((s) => /^[0-9A-Z]{8}$/.test(s)))];
  for (let i = 0; i < subs.length; i += 50) {
    const lote = subs.slice(i, i + 50);
    try {
      // Esta capa no admite paginar (rechaza resultRecordCount), asi que va sin fetchArcgisWhere. Trae una
      // fila por subdivision y el tope de la capa es 1000, lejos de los 50 por lote.
      const where = encodeURIComponent(`SUB8 IN (${lote.map((s) => `'${s}'`).join(",")})`);
      const respuesta = await fetch(`${capa}/query?where=${where}&outFields=SUB8,LEGAL_LINE&returnGeometry=false&f=json`);
      if (!respuesta.ok) continue;
      const cuerpo = (await respuesta.json()) as { error?: unknown; features?: unknown[] };
      if (cuerpo.error || !Array.isArray(cuerpo.features)) continue;
      for (const feature of cuerpo.features) {
        const a = ((feature as { attributes?: Record<string, unknown> }).attributes ?? {}) as Record<string, unknown>;
        const sub = String(a.SUB8 ?? "").trim().toUpperCase();
        const nombre = String(a.LEGAL_LINE ?? "").trim();
        if (sub && nombre && !porSub.has(sub)) porSub.set(sub, nombre);
      }
    } catch {
      // sigue con el resto
    }
  }
  for (const f of folios) {
    const folio = String(f ?? "").trim().toUpperCase();
    const nombre = porSub.get(folio.slice(0, 8));
    if (nombre) salida.set(folio, nombre);
  }
  return salida;
}

/** "494111BA0640" (unidad de condominio) da "494111BA0000"; un folio comun o ya maestro da null. */
export function folioMaestroCondominio(folio: string): string | null {
  const f = String(folio ?? "").trim().toUpperCase();
  if (!/^\d{6}[A-Z]{2}\d{4}$/.test(f) || f.endsWith("0000")) return null;
  return `${f.slice(0, 8)}0000`;
}

/** Centro de uno o varios poligonos (un complejo puede tener varios edificios): promedio de los vertices. */
export function centroDePoligonos(geometrias: Array<Record<string, unknown>>): { x: number; y: number } | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const g of geometrias) {
    const anillos = (g as { rings?: unknown }).rings;
    if (!Array.isArray(anillos) || !Array.isArray(anillos[0])) continue;
    for (const p of anillos[0] as unknown[]) {
      if (!Array.isArray(p) || typeof p[0] !== "number" || typeof p[1] !== "number") continue;
      sx += p[0];
      sy += p[1];
      n += 1;
    }
  }
  return n ? { x: sx / n, y: sy / n } : null;
}

async function poligonosPorFolio(capa: string, folios: string[]): Promise<Map<string, Array<Record<string, unknown>>>> {
  const mapa = new Map<string, Array<Record<string, unknown>>>();
  const validos = [...new Set(folios.map((f) => String(f ?? "").trim().toUpperCase()).filter((f) => /^[0-9A-Z]{8,14}$/.test(f)))];
  for (let i = 0; i < validos.length; i += 50) {
    const lote = validos.slice(i, i + 50);
    try {
      const features: unknown[] = await fetchArcgisWhere(capa, `FOLIO IN (${lote.map((f) => `'${f}'`).join(",")})`, 500);
      for (const feature of features) {
        const f = feature as { attributes?: Record<string, unknown>; geometry?: Record<string, unknown> };
        const folio = String(f.attributes?.FOLIO ?? "").trim().toUpperCase();
        if (!folio || !f.geometry) continue;
        mapa.set(folio, [...(mapa.get(folio) ?? []), f.geometry]);
      }
    } catch {
      // Un lote que falla deja esos folios sin ubicacion; no frena a los demas.
    }
  }
  return mapa;
}

/** Ubicacion de cada folio: su poligono, o el del edificio si es una unidad de condominio. */
export async function ubicacionesBroward(urlTabla: string, folios: string[]): Promise<Map<string, UbicacionParcela>> {
  const salida = new Map<string, UbicacionParcela>();
  const capa = await capaPoligonosBroward(urlTabla);
  if (!capa) return salida;
  const pedidos = [...new Set(folios.map((f) => String(f ?? "").trim().toUpperCase()).filter(Boolean))];
  const propios = await poligonosPorFolio(capa, pedidos);
  for (const folio of pedidos) {
    const centro = centroDePoligonos(propios.get(folio) ?? []);
    if (centro) salida.set(folio, { ...centro, fuente: "PARCELA" });
  }
  const faltan = pedidos.filter((f) => !salida.has(f) && folioMaestroCondominio(f));
  const maestros = await poligonosPorFolio(capa, faltan.map((f) => folioMaestroCondominio(f) as string));
  for (const folio of faltan) {
    const centro = centroDePoligonos(maestros.get(folioMaestroCondominio(folio) as string) ?? []);
    if (centro) salida.set(folio, { ...centro, fuente: "CONDOMINIO" });
  }
  return salida;
}

/**
 * Deja los registros de la tabla de Broward como los de los otros condados: ciudad con nombre (el codigo
 * queda en SITUS_CITY_CODIGO) y geometria de punto donde hay poligono. Lo que no se encuentra queda como
 * vino: sin coordenadas no se adivina.
 */
export async function normalizarRegistrosBroward(urlTabla: string, registros: unknown[]): Promise<unknown[]> {
  const leer = (r: unknown) => {
    const obj = (r ?? {}) as { attributes?: Record<string, unknown>; geometry?: Record<string, unknown> };
    return { obj, attrs: (obj.attributes ?? (obj as Record<string, unknown>)) as Record<string, unknown> };
  };
  const sinGeometria = registros
    .map(leer)
    .filter(({ obj }) => !obj.geometry)
    .map(({ attrs }) => String(attrs.FOLIO_NUMBER ?? "").trim())
    .filter(Boolean);
  const ubicaciones = sinGeometria.length ? await ubicacionesBroward(urlTabla, sinGeometria) : new Map();
  return registros.map((r) => {
    const { obj, attrs } = leer(r);
    const codigo = String(attrs.SITUS_CITY ?? "").trim().toUpperCase();
    const nombre = ciudadBroward(codigo);
    const nuevosAttrs = nombre ? { ...attrs, SITUS_CITY: nombre, SITUS_CITY_CODIGO: codigo } : { ...attrs };
    const ubicacion = ubicaciones.get(String(attrs.FOLIO_NUMBER ?? "").trim().toUpperCase());
    const geometria = obj.geometry ?? (ubicacion ? { x: ubicacion.x, y: ubicacion.y } : undefined);
    return obj.attributes
      ? { ...obj, attributes: nuevosAttrs, ...(geometria ? { geometry: geometria } : {}) }
      : { attributes: nuevosAttrs, ...(geometria ? { geometry: geometria } : {}) };
  });
}
