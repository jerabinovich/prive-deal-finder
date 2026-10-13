import type { ClaseCaso } from "../deals/distress-classification";
import { codigoCiudadBroward } from "./ciudades-broward";
import { fetchArcgisWhere } from "./connectors/arcgis";

/**
 * DEL DEMANDADO AL FOLIO, SIN ADIVINAR (13-oct-2026).
 *
 * Un expediente de foreclosure de Broward no trae folio ni direccion: trae la caratula. La ingesta
 * buscaba al demandado en el catastro por la PRIMERA PALABRA del nombre y se quedaba con el PRIMER
 * resultado. La capa del Property Appraiser no tiene OID y se pagina ordenando por FOLIO_NUMBER, y los
 * folios mas bajos son los del noroeste del condado (47-41, Parkland). Medido el 13-oct sobre los 121
 * expedientes guardados:
 *   - "City of Wilton Manors vs ANDREWS AVE RETAIL LLC" (dos locales en Wilton Manors) quedo pegado a la
 *     casa de "ANDREWS,EVA & JAMES R" en Parkland, el primer ANDREWS por folio.
 *   - "USHO 2541 LLC" (una casa en 2541 NW 9 ST) quedo en un multifamily de 113 NE 6 ST, y "2441 BAYVIEW
 *     DR LLC" en un terreno de Lighthouse Point. Las dos salieron en la alerta del 12-oct.
 *   - "Dean Thompson" quedo en la casa de "THOMPSON,DEANDRE CORNELIUS".
 *
 * Regla: el dueño del folio tiene que ser el demandado, por nombre completo normalizado. Entre varios
 * folios del demandado deciden los campos del caso, nunca el orden:
 *   - caso residencial: solo parcelas residenciales (codigo DOR 00 a 09);
 *   - caso homestead: la parcela con homestead (SOH_YEAR); caso non homestead: la que no lo tiene;
 *   - demandante municipal ("City of Wilton Manors"): la parcela dentro de ese municipio.
 * Si aun asi quedan varias que no se pueden distinguir, o ninguna, el expediente NO se engancha. Igual
 * que en la regla de JR: donde falta el dato, no dispara.
 */

export type DemandadoEmpresa = { tipo: "EMPRESA"; nucleo: string; sufijo: string | null; prefijo: string };
export type DemandadoPersona = {
  tipo: "PERSONA";
  nombre: string;
  medios: string[];
  apellido: string;
  apellidoCompuesto: string | null;
};
export type Demandado = DemandadoEmpresa | DemandadoPersona;

export type Candidata = { folio: string; dueno: string; uso: string; ciudad: string; homestead: boolean };
export type EstadoResolucion = "UNICA" | "MISMO_DUENO" | "AMBIGUA" | "SIN_COINCIDENCIA" | "SIN_NOMBRE";
export type Resolucion = { estado: EstadoResolucion; folios: string[]; motivo: string };
export type ContextoCaso = { clase: ClaseCaso; demandante?: string | null };

/** Tope de candidatas por consulta. Si se llega al tope puede haber mas, y entonces no se elige. */
export const TOPE_CANDIDATAS = 100;
/** Un mismo dueño con hasta 3 parcelas en la misma ciudad se toma como un solo sitio (locales contiguos). */
export const MAXIMO_PARCELAS_MISMO_SITIO = 3;

const SUFIJO_LEGAL: Record<string, string> = {
  LLC: "LLC",
  LC: "LLC",
  INC: "INC",
  INCORPORATED: "INC",
  CORP: "CORP",
  CORPORATION: "CORP",
  LTD: "LTD",
  LP: "LP",
  LLP: "LLP",
  PLLC: "PLLC",
  CO: "CO",
  COMPANY: "CO",
  TRUST: "TRUST",
};
/** Palabras que el catastro abrevia (el nombre tiene 70 caracteres): se comparan abreviadas. */
const ABREVIATURA: Record<string, string> = {
  CONDOMINIUM: "CONDO",
  CONDOMINIUMS: "CONDO",
  ASSOCIATION: "ASSN",
  ASSOCIATIONS: "ASSN",
  ASSOC: "ASSN",
  APARTMENTS: "APTS",
  APARTMENT: "APTS",
  MANAGEMENT: "MGMT",
  INTERNATIONAL: "INTL",
  DEVELOPMENT: "DEV",
  AVENUE: "AVE",
  STREET: "ST",
  BOULEVARD: "BLVD",
  DRIVE: "DR",
  ROAD: "RD",
  NUMBER: "NO",
};
const RE_EMPRESA =
  /\b(LLC|LC|INC|INCORPORATED|CORP|CORPORATION|LTD|LP|LLP|PLLC|CO|COMPANY|TRUST|ASSOCIATION|ASSN|HOLDINGS?|INVESTMENTS?|PROPERT(Y|IES)|ENTERPRISES?|GROUP|BANK|FUND|PARTNERS(HIP)?|VENTURES?|REALTY|CHURCH|MINISTRIES|CONDOMINIUM)\b/;
const GENERACIONALES = new Set(["JR", "SR", "II", "III", "IV"]);
/** Marcas de titularidad que el catastro agrega al nombre de una persona: no son nombres. */
const MARCAS_TITULARIDAD = new Set(["EST", "ESTATE", "TR", "TRS", "TRSTEE", "TRUSTEE", "LE", "REM", "JTWROS", "ETAL"]);

/** Mayusculas, "&" como AND, sin puntuacion salvo comas y guiones, espacios simples. */
export function limpiarNombre(texto: string): string {
  return (texto || "")
    .toUpperCase()
    .replace(/\bH\/E\b/g, " ")
    .replace(/&/g, " AND ")
    .replace(/['’`".()#]/g, "")
    .replace(/\//g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unificarSufijos(texto: string): string {
  return texto
    .replace(/\bL L C\b/g, "LLC")
    .replace(/\bLIMITED LIABILITY (COMPANY|CO)\b/g, "LLC")
    .replace(/\bLIMITED PARTNERSHIP\b/g, "LP");
}

/** Nombre de una sociedad sin el sufijo legal ni lo que viene despues ("A FLORIDA LIMITED..."). */
export function nucleoEmpresa(texto: string): { nucleo: string; sufijo: string | null } {
  const tokens = unificarSufijos(limpiarNombre(texto).replace(/,/g, " "))
    .split(" ")
    .filter(Boolean)
    .map((t) => ABREVIATURA[t] ?? t);
  if (tokens[0] === "THE" && tokens.length > 1) tokens.shift();
  const corte = tokens.findIndex((t, i) => i >= 1 && SUFIJO_LEGAL[t] !== undefined);
  if (corte === -1) return { nucleo: tokens.join(" "), sufijo: null };
  return { nucleo: tokens.slice(0, corte).join(" "), sufijo: SUFIJO_LEGAL[tokens[corte]] };
}

/**
 * Prefijo para el LIKE del catastro: hasta dos palabras del nombre, con el texto casi crudo. El catastro
 * guarda "&" (un AND escrito se busca como "&") y los apostrofos tal cual (van como "_", comodin de un
 * caracter). Corta antes de una palabra que el catastro abrevia o que trae otro signo. La comparacion
 * fina la hace coincideDueno sobre todas las candidatas.
 */
function prefijoEmpresa(crudo: string): string {
  const tokens = unificarSufijos(
    crudo.toUpperCase().replace(/['’`]/g, "_").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim(),
  ).split(" ");
  if (tokens[0] === "THE" && tokens.length > 1) tokens.shift();
  const partes: string[] = [];
  let palabras = 0;
  for (const original of tokens) {
    const t = original === "AND" ? "&" : original;
    if (!/^[A-Z0-9&_-]+$/.test(t) || ABREVIATURA[t] !== undefined || SUFIJO_LEGAL[t] !== undefined) break;
    if (t !== "&" && palabras === 2) break;
    partes.push(t);
    if (t !== "&") palabras += 1;
  }
  while (partes.length && partes[partes.length - 1] === "&") partes.pop();
  return partes.join(" ");
}

export function analizarDemandado(crudo: string): Demandado | null {
  const sinEtAl = (crudo || "").replace(/,?\s*\bet\.?\s*al\.?\b.*$/i, "");
  const base = limpiarNombre(sinEtAl).replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (!base) return null;
  if (RE_EMPRESA.test(unificarSufijos(base))) {
    const { nucleo, sufijo } = nucleoEmpresa(base);
    const prefijo = prefijoEmpresa(sinEtAl);
    if (!nucleo || !prefijo) return null;
    return { tipo: "EMPRESA", nucleo, sufijo, prefijo };
  }
  const tokens = base.split(" ").filter((t) => !GENERACIONALES.has(t));
  if (tokens.length < 2) return null;
  return {
    tipo: "PERSONA",
    nombre: tokens[0],
    medios: tokens.slice(1, -1),
    apellido: tokens[tokens.length - 1],
    // "Rodolfo Muniz Rivero": la palabra del medio puede ser el primer apellido. Una inicial no lo es.
    apellidoCompuesto:
      tokens.length >= 3 && tokens[tokens.length - 2].length > 1
        ? `${tokens[tokens.length - 2]} ${tokens[tokens.length - 1]}`
        : null,
  };
}

/** Prefijos a probar en orden. La persona con apellido compuesto prueba despues las dos ultimas palabras. */
export function prefijosDeBusqueda(d: Demandado): string[] {
  if (d.tipo === "EMPRESA") return [d.prefijo];
  const lista = [`${d.apellido},${d.nombre}`];
  if (d.apellidoCompuesto) lista.push(`${d.apellidoCompuesto},${d.nombre}`);
  return lista;
}

/**
 * Cuanto se parece el dueño del folio al demandado: 0 no es, 1 coincide sin segundo nombre que comparar,
 * 2 el segundo nombre coincide por inicial, 3 coincide entero. El catastro guarda personas como
 * "APELLIDO,NOMBRE MEDIO & ...". Dos segundos nombres escritos enteros y distintos son dos personas.
 */
export function fuerzaCoincidencia(d: Demandado, dueno: string): number {
  if (d.tipo === "EMPRESA") {
    const otro = nucleoEmpresa(dueno);
    if (otro.nucleo !== d.nucleo) return 0;
    return !d.sufijo || !otro.sufijo || d.sufijo === otro.sufijo ? 1 : 0;
  }
  const limpio = limpiarNombre(dueno);
  const coma = limpio.indexOf(",");
  if (coma <= 0) return 0;
  const apellido = limpio.slice(0, coma).trim();
  const porCompuesto = d.apellidoCompuesto !== null && apellido === d.apellidoCompuesto;
  if (apellido !== d.apellido && !porCompuesto) return 0;
  const resto = limpio
    .slice(coma + 1)
    .split(" AND ")[0]
    .trim()
    .split(" ")
    .filter((t) => t && !GENERACIONALES.has(t) && !MARCAS_TITULARIDAD.has(t));
  if (resto[0] !== d.nombre) return 0;
  // Con apellido compuesto la palabra del medio era el primer apellido: no hay segundo nombre que comparar.
  const medios = porCompuesto ? d.medios.slice(0, -1) : d.medios;
  const medioDueno = resto[1];
  if (!medios.length || !medioDueno) return 1;
  if (medios.includes(medioDueno)) return 3;
  const porInicial = medios.some(
    (m) => (m.length === 1 || medioDueno.length === 1) && m[0] === medioDueno[0],
  );
  return porInicial ? 2 : 0;
}

export function coincideDueno(d: Demandado, dueno: string): boolean {
  return fuerzaCoincidencia(d, dueno) > 0;
}

const esUsoResidencial = (uso: string) => /^0\d$/.test((uso || "").trim());

/** Quedarse con las que cumplen, salvo que no cumpla ninguna: un filtro que vacia no decide nada. */
function preferir(pool: Candidata[], cumple: (c: Candidata) => boolean): Candidata[] {
  const filtradas = pool.filter(cumple);
  return filtradas.length ? filtradas : pool;
}

/** "CITY OF WILTON MANORS Plaintiff vs. ..." da "WM". Solo municipios de Broward. */
export function codigoMunicipioDemandante(demandante?: string | null): string | null {
  const m = String(demandante ?? "")
    .toUpperCase()
    .match(/^\s*(CITY|TOWN|VILLAGE)\s+OF\s+([A-Z .'-]+?)(\s*,|\s+A\s+FLORIDA|\s+PLAINTIFF|\s*$)/);
  return m ? codigoCiudadBroward(m[2]) : null;
}

export function elegirParcelas(
  d: Demandado,
  contexto: ContextoCaso,
  candidatas: Candidata[],
  llegoAlTope: boolean,
): Resolucion {
  if (llegoAlTope) {
    return { estado: "AMBIGUA", folios: [], motivo: `el catastro devolvio el tope de ${TOPE_CANDIDATAS} candidatas` };
  }
  const delDemandado = candidatas.filter((c) => coincideDueno(d, c.dueno));
  const residencial = contexto.clase === "RES_HOMESTEAD" || contexto.clase === "RES_NO_HOMESTEAD";
  let pool = residencial ? delDemandado.filter((c) => esUsoResidencial(c.uso)) : delDemandado;
  const municipio = codigoMunicipioDemandante(contexto.demandante);
  if (municipio) pool = preferir(pool, (c) => c.ciudad === municipio);
  // El expediente trae segundo nombre: el folio que lo tiene entero gana al que no lo tiene.
  const mejor = Math.max(0, ...pool.map((c) => fuerzaCoincidencia(d, c.dueno)));
  pool = pool.filter((c) => fuerzaCoincidencia(d, c.dueno) === mejor);
  if (contexto.clase === "RES_HOMESTEAD") pool = preferir(pool, (c) => c.homestead);
  if (contexto.clase === "RES_NO_HOMESTEAD") pool = preferir(pool, (c) => !c.homestead);
  const folios = [...new Set(pool.map((c) => c.folio))];

  if (!folios.length) {
    const motivo = delDemandado.length
      ? `${delDemandado.length} parcela(s) del demandado, ninguna residencial para un caso residencial`
      : "ningun dueño con ese nombre en el catastro";
    return { estado: "SIN_COINCIDENCIA", folios: [], motivo };
  }
  if (folios.length === 1) return { estado: "UNICA", folios, motivo: "un solo folio del demandado" };
  const ciudades = new Set(pool.map((c) => c.ciudad));
  if (d.tipo === "EMPRESA" && folios.length <= MAXIMO_PARCELAS_MISMO_SITIO && ciudades.size === 1) {
    return { estado: "MISMO_DUENO", folios, motivo: `${folios.length} folios del mismo dueño en la misma ciudad` };
  }
  return { estado: "AMBIGUA", folios: [], motivo: `${folios.length} folios posibles, no se distingue cual` };
}

function aCandidata(feature: unknown): Candidata {
  const a = ((feature as { attributes?: Record<string, unknown> })?.attributes ?? {}) as Record<string, unknown>;
  const s = (k: string) => String(a[k] ?? "").trim();
  // SOH_YEAR es el año base de Save Our Homes, que solo existe con homestead. "--" es sin homestead.
  return {
    folio: s("FOLIO_NUMBER"),
    dueno: s("NAME_LINE_1"),
    uso: s("USE_CODE"),
    ciudad: s("SITUS_CITY"),
    homestead: /^\d{2}$/.test(s("SOH_YEAR")),
  };
}

/**
 * Resuelve el demandado contra el catastro de Broward. Devuelve los folios elegidos y sus features
 * completos (los que ingestArcgisRecords necesita para crear el deal). Un error de red se propaga:
 * quien llama decide si reintenta.
 */
export async function resolverDemandadoBroward(
  url: string,
  demandadoCrudo: string,
  contexto: ContextoCaso,
): Promise<{ resolucion: Resolucion; features: unknown[] }> {
  const d = analizarDemandado(demandadoCrudo);
  if (!d) return { resolucion: { estado: "SIN_NOMBRE", folios: [], motivo: "demandado sin nombre util" }, features: [] };
  let ultima: Resolucion = { estado: "SIN_COINCIDENCIA", folios: [], motivo: "sin consulta" };
  for (const prefijo of prefijosDeBusqueda(d)) {
    const where = `NAME_LINE_1 LIKE '${prefijo.replace(/'/g, "''")}%'`;
    const features: unknown[] = await fetchArcgisWhere(url, where, TOPE_CANDIDATAS, "FOLIO_NUMBER");
    ultima = elegirParcelas(d, contexto, features.map(aCandidata), features.length >= TOPE_CANDIDATAS);
    if (ultima.estado !== "SIN_COINCIDENCIA") {
      const elegidos = new Set(ultima.folios);
      return { resolucion: ultima, features: features.filter((f) => elegidos.has(aCandidata(f).folio)) };
    }
  }
  return { resolucion: ultima, features: [] };
}

/** El demandante de la caratula de Broward ("X Plaintiff vs. Y Defendant"). */
export function demandanteDeCaratula(caratula?: string | null): string {
  return String(caratula ?? "").split(/\s+Plaintiff\b/i)[0].trim();
}
