import { readFileSync } from "fs";
import { RUTA_BUYBOX_POR_DEFECTO } from "./parcelas-corredores";

/**
 * PALM BEACH POR CORREDORES (14-oct-2026).
 *
 * POR QUE. PALM_BEACH_PARCELS_URL apunta a la capa de la ciudad de West Palm Beach (46.628 parcelas): Palm Beach,
 * Boca Raton, Jupiter, Manalapan y Gulf Stream no entraban nunca. Ahora se usa la capa del condado (PARCEL_DETAILS,
 * 684.864 parcelas, con dueno, domicilio postal y poligono).
 *
 * MUNICIPIO. Esa capa no trae el zip del sitio, y su MUNICIPALITY es la ciudad postal: "BOCA RATON" incluye 62.640
 * parcelas no incorporadas del oeste, "JUPITER" 10.283 y "WEST PALM BEACH" 54.427. La jurisdiccion real son los dos
 * primeros digitos del PCN (PARCEL_NUMBER): 06 Boca Raton, 20 Gulf Stream, 30 Jupiter, 42 Manalapan, 50 Palm Beach,
 * 74 West Palm Beach; 00 es el condado no incorporado. Medido contra la capa el 14 oct.
 *
 * WEST PALM BEACH. Su corredor es solo el zip 33401. Se piden las secciones del PCN (74 43 43 SS) que tocan ese zip
 * (medido sobre 20.437 parcelas de la ciudad) y despues quedan solo las que tienen el centro dentro de la ZCTA 33401
 * del Census 2020 (TIGERweb, simplificada a 0,0001 grados). La consulta espacial del servidor del condado tarda 30 s
 * y con poligono pagina mal (devolvio 2 de 200); por eso ese filtro va de este lado.
 *
 * FOLIO. PARID no sirve: en los condominios es el del edificio (10 digitos) y se repite en cada unidad. PARCEL_NUMBER
 * tiene siempre 17 digitos y es unico; fuera de los condominios es igual a PARID, asi que los deals que ya existen
 * se reconocen.
 */
export const CAPA_PALM_BEACH = "https://gis.pbcgov.org/arcgis/rest/services/Parcels/PARCEL_INFO/FeatureServer/4";

/** Codigo de municipio del PCN (los dos primeros digitos), medido contra la capa del condado. */
export const CODIGO_MUNICIPIO_PB: Record<string, string> = {
  "BOCA RATON": "06",
  "GULF STREAM": "20",
  JUPITER: "30",
  MANALAPAN: "42",
  "PALM BEACH": "50",
  "PALM BEACH SHORES": "54",
  "RIVIERA BEACH": "56",
  "WEST PALM BEACH": "74",
};

/** Municipios de corredores con zips de Palm Beach que estan en otro condado (Jupiter Island es de Martin). */
const FUERA_DEL_CONDADO = new Set(["JUPITER ISLAND"]);

/** ZCTA 33401 del Census 2020 (TIGERweb), en grados (WGS84). Dos partes: el centro y un enclave al sudoeste. */
export const ZCTA_33401: number[][][] = [
  [[-80.09135,26.72453],[-80.09,26.74962],[-80.08819,26.7495],[-80.08707,26.74908],[-80.08386,26.74585],
   [-80.07956,26.74885],[-80.07788,26.74841],[-80.07548,26.74833],[-80.07446,26.74722],[-80.07303,26.74658],
   [-80.07108,26.74643],[-80.07046,26.74372],[-80.07075,26.7421],[-80.0707,26.74097],[-80.0691,26.73771],
   [-80.0686,26.73609],[-80.06808,26.73326],[-80.06808,26.73103],[-80.06854,26.73011],[-80.06951,26.72961],
   [-80.07062,26.72975],[-80.0721,26.73046],[-80.07215,26.7307],[-80.0731,26.73103],[-80.07379,26.73099],
   [-80.07529,26.73051],[-80.07605,26.72985],[-80.07712,26.72962],[-80.07754,26.72501],[-80.07552,26.72496],
   [-80.07549,26.72596],[-80.07633,26.72607],[-80.07626,26.72769],[-80.07604,26.72843],[-80.0756,26.72913],
   [-80.07481,26.7298],[-80.07399,26.73017],[-80.07303,26.73032],[-80.0729,26.73021],[-80.0729,26.72957],
   [-80.07032,26.72891],[-80.06901,26.729],[-80.06783,26.72969],[-80.06627,26.72931],[-80.06653,26.72752],
   [-80.05496,26.72723],[-80.05495,26.72765],[-80.05349,26.72764],[-80.0535,26.72719],[-80.05312,26.72718],
   [-80.05311,26.72754],[-80.05051,26.72747],[-80.05046,26.72631],[-80.04977,26.72434],[-80.0469,26.72422],
   [-80.0471,26.71689],[-80.04632,26.70733],[-80.04656,26.70461],[-80.04676,26.69046],[-80.04996,26.69058],
   [-80.05,26.69033],[-80.05045,26.69035],[-80.05045,26.69021],[-80.05268,26.69027],[-80.05267,26.69065],
   [-80.05436,26.6907],[-80.05438,26.69032],[-80.05647,26.69037],[-80.05647,26.69071],[-80.06459,26.69103],
   [-80.06459,26.6906],[-80.06663,26.69065],[-80.06711,26.69246],[-80.07267,26.70205],[-80.07736,26.70865],
   [-80.07989,26.71134],[-80.08746,26.71689],[-80.08898,26.71834],[-80.08994,26.71965],[-80.09055,26.72081],
   [-80.09104,26.72219],[-80.09135,26.72453]],
  [[-80.07494,26.694],[-80.0746,26.69562],[-80.07371,26.69706],[-80.07295,26.69546],[-80.07212,26.69578],
   [-80.07058,26.69575],[-80.07065,26.69444],[-80.06912,26.69438],[-80.06854,26.6934],[-80.07154,26.69077],
   [-80.075,26.69087],[-80.07494,26.694]],
];

/** ZCTA 33404 del Census 2020 (TIGERweb, simplificada a 0,0001 grados), en grados (WGS84). Riviera Beach con Singer Island
 * y Palm Beach Shores (23-oct-2026, JR sumo 33404 a los corredores). */
export const ZCTA_33404: number[][][] = [
  [
   [-80.10752,26.77931],[-80.10749,26.77978],[-80.10594,26.7787],[-80.10585,26.7788],[-80.10566,26.78337],[-80.10649,26.78342],
   [-80.10646,26.78421],[-80.10711,26.78423],[-80.10701,26.78702],[-80.09915,26.78681],[-80.09894,26.79419],[-80.09862,26.79418],
   [-80.09841,26.80065],[-80.09143,26.80036],[-80.08954,26.80035],[-80.0892,26.80059],[-80.08883,26.80053],[-80.09099,26.79549],
   [-80.09116,26.79379],[-80.0856,26.79345],[-80.06923,26.79303],[-80.06929,26.7918],[-80.06733,26.79175],[-80.06729,26.79261],
   [-80.0632,26.79238],[-80.05998,26.79243],[-80.05485,26.79224],[-80.05484,26.79259],[-80.04725,26.79248],[-80.04886,26.80404],
   [-80.03752,26.80503],[-80.0391,26.80926],[-80.03896,26.81312],[-80.04122,26.81438],[-80.03542,26.8142],[-80.03559,26.81474],
   [-80.03112,26.81447],[-80.02711,26.79721],[-80.02831,26.79421],[-80.02873,26.78734],[-80.02863,26.78436],[-80.02786,26.78157],
   [-80.02791,26.77294],[-80.03585,26.77311],[-80.04055,26.77194],[-80.04875,26.76924],[-80.04958,26.76926],[-80.04914,26.76329],
   [-80.08523,26.76433],[-80.10752,26.77931]],
];

export type MunicipioParcial = { zips: string[]; prefijos: string[]; anillos: number[][][] };

/** Municipios cuyo corredor es solo una parte de la ciudad. */
export const MUNICIPIOS_PARCIALES: Record<string, MunicipioParcial> = {
  "WEST PALM BEACH": {
    zips: ["33401"],
    prefijos: ["07", "08", "09", "15", "16", "17", "18", "19", "20", "21", "22", "27", "28", "29"].map((s) => `744343${s}`),
    anillos: ZCTA_33401,
  },
  // 23-oct-2026: Riviera Beach tiene 17.516 parcelas; 14.219 con el centro en 33404 y 3.297 afuera (sobre todo las
  // secciones 56424225 y 56424236, al noroeste). Se piden las 13 secciones que tocan 33404 y despues queda solo lo
  // que cae adentro. Palm Beach Shores (54) esta entera en 33404 y va completa.
  "RIVIERA BEACH": {
    zips: ["33404"],
    prefijos: ["56424225", "56434215", "56434219", "56434222", "56434223", "56434226", "56434227", "56434228", "56434229", "56434230", "56434231", "56434232", "56434233"],
    anillos: ZCTA_33404,
  },
};

/**
 * Usos del buy box, con la grafia exacta de PROPERTY_USE. Son los mismos codigos DOR que se piden en Miami-Dade y
 * Broward (00, 03, 08, 10 a 49, 80 y 86 a 89; ver dor-use-codes.ts). Quedan afuera, aunque su codigo entre, las
 * amarras de marina en condominio, las unidades de condo hotel y el tiempo compartido: no son buy box.
 */
export const USOS_BUY_BOX_PB = [
  // tierra residencial (00)
  "VACANT", "VACANT TOWNHOUSE", "VACANT CONDO LAND",
  // multifamiliar (03 y 08)
  "MULTIFAMILY 10 UNITS OR MORE", "MULTIFAMILY > 10 units Income Restricted", "MULTIFAMILY < 5 UNITS", "MFR 5 TO 9 UNITS",
  "MULTIFAMILY < 10 UNITS-COMM ZONING", "MULTIFAMILY < 10 UNITS-IND ZONING", "MFR-IMP NON CONTRIBUTING",
  // tierra comercial, retail, oficina y servicios (10 a 39)
  "VACANT COMMERCIAL LAND", "VACANT COMM CONDO LAND", "STORES", "STORES CONDO", "SMALL DISCOUNT STORE < 25000 SF",
  "STORE/OFFICE/RESIDENTIAL", "STORE/OFF/RES CONDO", "DEPARTMENT STORE", "SUPERMARKET/DRUG STORE", "SHOPPING CENTER REGIONAL",
  "SHOPPING CENTER CMMITY", "SH CTR CMMITY CONDO", "OFFICE BLDG-NON MEDICAL 1 TO 3 STORIES",
  "OFF BLDG- NON MEDIC 1 TO 3 STORIES CONDO", "OFFICE BLDG- NON MEDICAL 4 STORIES & UP", "OFF BLDG- NON MEDIC 4 STORIES & UP CONDO",
  "MEDICAL OFFICE- BUILDING UP TO 4 STORIES", "MEDIC OFFIC- BLDG UP TO 4 STORIES CONDO", "AIRPORT/MARINA", "RESTAURANT",
  "RESTAURANT CONDO", "RESTAURANT, DRIVE IN", "FINANCIAL", "INSURANCE", "SERVICE SHOPS", "SERVICE STATION", "AUTO SALES",
  "PKG LT / MH PK", "THTR/AUD/CLBHS", "NIGHT CLUBS", "Bowling / skating rink", "TOURIST ATTRAC", "RACETRACK", "GOLF COURSE",
  "MOTEL",
  // industrial (40 a 49)
  "VACANT INDUSTRIAL", "VACANT INDUS CONDO", "LIGHT MFG", "HEAVY MFG", "LUMBER YARD/MILL", "PACKING", "BOTTLER",
  "FOOD PROCESSING", "MIN PROCESSING", "WAREH/DIST TERM", "WAREH/DIST TERM CONDO", "SELF STORAGE", "OPEN STORAGE",
  // tierra publica, carril P3 (86 a 89)
  "CITY INC NONMUNI", "DISTRICTS", "STATE", "FEDERAL", "MUNICIPAL",
];

export type CorredoresPalmBeach = { prefijos: string[]; parciales: MunicipioParcial[]; sinSoporte: string[] };

/**
 * Los corredores de buybox.json con zips de Palm Beach (334xx), traducidos a codigos del PCN. Un municipio sin
 * codigo medido, o un corredor parcial con zips distintos de los medidos, no se adivina: queda en sinSoporte.
 */
export function corredoresPalmBeach(ruta = process.env.BUYBOX_JSON || RUTA_BUYBOX_POR_DEFECTO): CorredoresPalmBeach {
  const bb = JSON.parse(readFileSync(ruta, "utf-8")) as { corredores_tier1?: Record<string, unknown> };
  const completos = new Set<string>();
  const parciales = new Map<string, MunicipioParcial>();
  const sinSoporte = new Set<string>();
  for (const [nombre, corredor] of Object.entries(bb.corredores_tier1 ?? {})) {
    if (nombre.startsWith("_") || !corredor || typeof corredor !== "object") continue;
    const c = corredor as { zips?: unknown[]; municipios?: unknown[] };
    const zips = (c.zips ?? []).map((z) => String(z ?? "").trim()).filter((z) => /^334\d{2}$/.test(z)).sort();
    if (!zips.length) continue;
    const municipios = (c.municipios ?? []).map((m) => String(m ?? "").trim().toUpperCase()).filter(Boolean);
    if (!municipios.length) sinSoporte.add(`${nombre}: sin municipios`);
    for (const m of municipios) {
      if (FUERA_DEL_CONDADO.has(m)) continue;
      const parcial = MUNICIPIOS_PARCIALES[m];
      if (parcial) {
        if (parcial.zips.join(",") === zips.join(",")) parciales.set(m, parcial);
        else sinSoporte.add(`${nombre}: ${m} con zips ${zips.join(",")}`);
      } else if (CODIGO_MUNICIPIO_PB[m]) {
        completos.add(CODIGO_MUNICIPIO_PB[m]);
      } else {
        sinSoporte.add(`${nombre}: ${m}`);
      }
    }
  }
  const prefijos = [...completos, ...[...parciales.values()].flatMap((p) => p.prefijos)].sort();
  if (!prefijos.length) throw new Error(`buybox.json sin corredores de Palm Beach con municipio conocido (${ruta})`);
  return { prefijos, parciales: [...parciales.values()], sinSoporte: [...sinSoporte].sort() };
}

const comillas = (t: string) => `'${t.replace(/'/g, "''")}'`;

export function wherePalmBeach(c: CorredoresPalmBeach): string {
  return (
    `(${c.prefijos.map((p) => `PARCEL_NUMBER LIKE '${p}%'`).join(" OR ")}) AND ` +
    `PROPERTY_USE IN (${USOS_BUY_BOX_PB.map(comillas).join(",")})`
  );
}

type Registro = { attributes?: Record<string, unknown>; geometry?: { rings?: number[][][] } };

function centroDe(registro: Registro): [number, number] | null {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const anillo of registro.geometry?.rings ?? []) {
    for (const [x, y] of anillo) {
      if (Number.isFinite(x) && Number.isFinite(y)) {
        sx += x;
        sy += y;
        n += 1;
      }
    }
  }
  return n ? [sx / n, sy / n] : null;
}

/** Punto en poligono por paridad: sirve igual para partes separadas y para huecos. */
export function dentroDe([x, y]: [number, number], anillos: number[][][]): boolean {
  let adentro = false;
  for (const a of anillos) {
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
      const [xi, yi] = a[i];
      const [xj, yj] = a[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) adentro = !adentro;
    }
  }
  return adentro;
}

/** Las parcelas de un municipio parcial cuentan solo con el centro dentro de su zip; sin geometria, afuera. */
export function dentroDelCorredor(registro: unknown, c: CorredoresPalmBeach): boolean {
  const r = (registro || {}) as Registro;
  const pcn = String(r.attributes?.PARCEL_NUMBER ?? r.attributes?.PARID ?? "");
  const parcial = c.parciales.find((p) => p.prefijos.some((pre) => pcn.startsWith(pre)));
  if (!parcial) return true;
  const centro = centroDe(r);
  return centro ? dentroDe(centro, parcial.anillos) : false;
}

const MUNICIPIO_DEL_CODIGO: Record<string, string> = Object.fromEntries(
  Object.entries(CODIGO_MUNICIPIO_PB).map(([municipio, codigo]) => [codigo, municipio]),
);

/**
 * El folio de cada parcela es su PCN de 17 digitos (en los condominios, PARID es el del edificio). Si la capa no
 * trae MUNICIPALITY (pasa con parcelas sin direccion: campos de golf, distritos, calles), sale del codigo del PCN.
 */
export function normalizarRegistroPalmBeach(registro: unknown): unknown {
  const r = (registro || {}) as Registro;
  const pcn = String(r.attributes?.PARCEL_NUMBER ?? "").trim();
  if (!r.attributes || !/^\d{17}$/.test(pcn)) return registro;
  const municipio = String(r.attributes.MUNICIPALITY ?? "").trim() || MUNICIPIO_DEL_CODIGO[pcn.slice(0, 2)];
  return { ...r, attributes: { ...r.attributes, PARID: pcn, ...(municipio ? { MUNICIPALITY: municipio } : {}) } };
}

/** La capa repite filas de una misma parcela (una por cada situs o venta): queda la primera de cada PCN. */
export function sinRepetidas(registros: unknown[]): unknown[] {
  const vistos = new Set<string>();
  return registros.filter((registro) => {
    const pcn = String((registro as Registro)?.attributes?.PARCEL_NUMBER ?? "").trim();
    if (!pcn) return true;
    if (vistos.has(pcn)) return false;
    vistos.add(pcn);
    return true;
  });
}
