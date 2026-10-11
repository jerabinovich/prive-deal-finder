/**
 * CODIGOS DE USO DEL SUELO DEL DOR DE FLORIDA — Regla 12D-8.008, F.A.C.
 *
 * POR QUE EXISTE ESTO. Broward (BCPA) manda USE_CODE como numero ("01", "94"),
 * no como descripcion. Palm Beach y Miami-Dade mandan texto. Resultado medido
 * el 13-sep: los 50 deals de Broward entraron con assetType vacio, las reglas
 * de ruido (que buscan palabras: RAILROAD, COMMON AREA, ROADWAY) no podian
 * dispararse, y TODOS caian en "otro tipo de activo" aunque fueran land o
 * multifamily. Solo los filtraba el gate de propietario.
 *
 * Las descripciones son transcripcion fiel del listado del DOR, no redaccion
 * propia: son las mismas que publican los property appraisers de Florida.
 *
 * Se traduce SOLO cuando el valor es un codigo pelado de 1-2 digitos. Un
 * condado que ya manda texto pasa intacto.
 */
export const DOR_USE_CODES: Record<string, string> = {
  // Residencial
  "00": "Vacant Residential",
  "01": "Single Family",
  "02": "Mobile Homes",
  "03": "Multi-family - 10 units or more",
  "04": "Condominia",
  "05": "Cooperatives",
  "06": "Retirement Homes",
  "07": "Miscellaneous Residential",
  "08": "Multi-family - less than 10 units",
  "09": "Residential Common Elements/Areas",
  // Comercial
  "10": "Vacant Commercial",
  "11": "Stores, one story",
  "12": "Mixed use - store and office or residential",
  "13": "Department Stores",
  "14": "Supermarkets",
  "15": "Regional Shopping Centers",
  "16": "Community Shopping Centers",
  "17": "Office buildings, one story",
  "18": "Office buildings, multi-story",
  "19": "Professional service buildings",
  "20": "Airports, bus terminals, marine terminals, piers, marinas",
  "21": "Restaurants, cafeterias",
  "22": "Drive-in Restaurants",
  "23": "Financial institutions",
  "24": "Insurance company offices",
  "25": "Repair service shops",
  "26": "Service stations",
  "27": "Auto sales, auto repair and storage",
  "28": "Parking lots, mobile home parks",
  "29": "Wholesale outlets, produce houses, manufacturing outlets",
  "30": "Florist, greenhouses",
  "31": "Drive-in theaters, open stadiums",
  "32": "Enclosed theaters, enclosed auditoriums",
  "33": "Nightclubs, cocktail lounges, bars",
  "34": "Bowling alleys, skating rinks, pool halls, enclosed arenas",
  "35": "Tourist attractions, permanent exhibits",
  "36": "Camps",
  "37": "Race tracks",
  "38": "Golf courses, driving ranges",
  "39": "Hotels, motels",
  // Industrial
  "40": "Vacant Industrial",
  "41": "Light manufacturing",
  "42": "Heavy industrial",
  "43": "Lumber yards, sawmills, planning mills",
  "44": "Packing plants",
  "45": "Canneries, bottlers and brewers, distilleries, wineries",
  "46": "Other food processing",
  "47": "Mineral processing, cement plants, refineries",
  "48": "Warehousing, distribution terminals, trucking terminals",
  "49": "Open storage, junk yards, auto wrecking, fuel storage",
  // Agricola
  "50": "Improved agricultural",
  "51": "Cropland soil capability Class I",
  "52": "Cropland soil capability Class II",
  "53": "Cropland soil capability Class III",
  "54": "Timberland - site index 90 and above",
  "55": "Timberland - site index 80 to 89",
  "56": "Timberland - site index 70 to 79",
  "57": "Timberland - site index 60 to 69",
  "58": "Timberland - site index 50 to 59",
  "59": "Timberland not classified by site index",
  "60": "Grazing land soil capability Class I",
  "61": "Grazing land soil capability Class II",
  "62": "Grazing land soil capability Class III",
  "63": "Grazing land soil capability Class IV",
  "64": "Grazing land soil capability Class V",
  "65": "Grazing land soil capability Class VI",
  "66": "Orchard Groves, Citrus",
  "67": "Poultry, bees, tropical fish, rabbits",
  "68": "Dairies, feed lots",
  "69": "Ornamentals, miscellaneous agricultural",
  // Institucional
  "70": "Vacant Institutional",
  "71": "Churches",
  "72": "Private schools and colleges",
  "73": "Privately owned hospitals",
  "74": "Homes for the aged",
  "75": "Orphanages, non-profit or charitable services",
  "76": "Mortuaries, cemeteries, crematoriums",
  "77": "Clubs, lodges, union halls",
  "78": "Sanitariums, convalescent and rest homes",
  "79": "Cultural organizations, facilities",
  // Gubernamental
  "80": "Vacant Governmental",
  "81": "Military",
  "82": "Forest, parks, recreational areas",
  "83": "Public county schools",
  "84": "Colleges (non private)",
  "85": "Hospitals (non private)",
  "86": "Counties, including non-municipal government",
  "87": "State, other than military, forests, parks",
  "88": "Federal, other than military, forests, parks",
  "89": "Municipal, other than parks, recreational areas",
  // Misceláneo
  "90": "Leasehold interests (government owned property)",
  "91": "Utility, gas and electricity, telephone, locally assessed railroads, water and sewer, pipelines, canals",
  "92": "Mining lands, petroleum lands, gas lands",
  "93": "Subsurface rights",
  "94": "Right-of-way, streets, roads, irrigation channel, ditch",
  "95": "Rivers and lakes, submerged lands",
  "96": "Sewage disposal, solid waste, borrow pits, drainage reservoirs, waste land, marsh, sand dunes, swamps",
  "97": "Outdoor recreational or parkland",
  "98": "Centrally assessed",
  "99": "Acreage not classified agricultural",
};

/**
 * Devuelve la descripcion si `value` es un codigo DOR pelado; si no, lo deja
 * pasar tal cual (los condados que mandan texto no se tocan).
 */
export function resolveDorUseCode(value?: string | null): string | undefined {
  if (!value) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;
  if (!/^\d{1,2}$/.test(raw)) return raw;
  const key = raw.padStart(2, "0");
  const description = DOR_USE_CODES[key];
  return description ? `${description} (DOR ${key})` : raw;
}

/**
 * Codigos DOR cuya propiedad NO es adquirible para un desarrollador.
 *
 * Se filtra por CODIGO y no por palabras porque el texto engania: la descripcion
 * oficial del 96 es "...borrow pits, drainage reservoirs, waste land, marsh,
 * sand dunes, swamps" y contiene la palabra "land", asi que un pantano entraba
 * puntuando como si fuera terreno desarrollable (medido: 45/100). El codigo es
 * univoco; el texto no.
 *
 *   80-89  gubernamental (municipal, condado, estado, federal, militar, parques,
 *          escuelas, colleges y hospitales publicos)
 *   09     areas y elementos comunes de un condominio
 *   91-98  utility, mineria, derechos de subsuelo, calles y servidumbres,
 *          tierras sumergidas, saneamiento y pantanos, parkland, centrally assessed
 */
/**
 * TIERRA PUBLICA QUE SI PUEDE VENDERSE — 28-sep-2026, decision de JR.
 *
 * El enum DealLane tiene un carril GOV_LAND_P3 que estaba vacio POR DISENO:
 * los codigos 80 a 89 estaban todos en el set de no adquirible, asi que el
 * GATE 0 los mandaba a score 0 y el carril no se podia poblar nunca.
 *
 * Medido: de las 18 parcelas gubernamentales de la base, 8 son DOR 82, o sea
 * bosques y parques de Broward, y 10 son de Miami-Dade: 6 gubernamental
 * vacante, 2 del condado, 2 municipales. Esas 10 pueden ser excedente.
 * Militar (81), parques (82), escuelas (83), colleges (84) y hospitales
 * publicos (85) siguen fuera: no se compran.
 */
export const GOV_P3_CODES = new Set<string>(["80", "86", "87", "88", "89"]);

const NON_ACQUIRABLE_CODES = new Set<string>([
  "09",
  "81", "82", "83", "84", "85",
  "91", "92", "93", "94", "95", "96", "97", "98",
]);

/**
 * VOCABULARIOS DE CONDADO A CODIGO DOR — 28-sep-2026
 *
 * POR QUE. Medido sobre los 360 deals: solo Broward manda el codigo DOR, 113 de
 * 113. Miami-Dade manda 198 valores de texto propio y Palm Beach 46, o sea 244
 * de 360 (68%) sin codigo. La version anterior de isNonAcquirableDorCode solo
 * sabia leer el numero pelado o el sufijo "(DOR NN)", asi que para esos 244
 * devolvia false SIEMPRE y el GATE 0 de score.ts no podia disparar nunca.
 * Medido: Broward marca ruido en 34 de 113 (30%), Miami-Dade en 12 de 199 (6%),
 * Palm Beach en 2 de 46 (4%). No son mejores parcelas: son gates apagados.
 *
 * Las claves son transcripcion de los valores REALES de la base, no inventadas.
 * En Miami-Dade el valor tiene forma "CATEGORIA : SUBCATEGORIA" y la categoria
 * es la que manda; en Palm Beach el valor entero es la categoria.
 */
const MIAMI_DADE_USE_TO_DOR: Record<string, string> = {
  "RESIDENTIAL - SINGLE FAMILY": "01",
  "RESIDENTIAL - TOTAL VALUE": "01",
  "MULTIFAMILY 2-9 UNITS": "08",
  "MULTIFAMILY 10 UNITS PLUS": "03",
  "VACANT RESIDENTIAL": "00",
  "VACANT LAND - COMMERCIAL": "10",
  "VACANT LAND - INDUSTRIAL": "40",
  "VACANT GOVERNMENTAL": "80",
  "CENTRALLY ASSESSED": "98",
  "LIGHT MANUFACTURING": "41",
  "SERVICE STATION": "26",
  MUNICIPAL: "89",
  COUNTY: "86",
  "AUTOMOTIVE OR MARINE": "27",
  STORE: "11",
  "LEASEHOLD INTEREST": "90",
  "ACREAGE NOT CLASSIFIED AG": "99",
  "PARKING LOT/MOBILE HOME PARK": "28",
  "OFFICE BUILDING - ONE STORY": "17",
  "OFFICE BUILDING - MULTISTORY": "18",
  "COMMUNITY SHOPPING CENTER": "16",
  "RESTAURANT OR CAFETERIA": "21",
  "RELIGIOUS - EXEMPT": "71",
  "HOME FOR THE AGED": "74",
  "BENEVOLENT - EXEMPT": "77",
  "IMPROVED PASTURES": "50",
  "PVT PARK -REC AREA -ROADWAY": "94",
};

const PALM_BEACH_USE_TO_DOR: Record<string, string> = {
  CONDOMINIUM: "04",
  "SINGLE FAMILY": "01",
  TOWNHOUSE: "01",
  "RESIDENTIAL COMMON AREA/ELEMENT": "09",
  "WAREH/DIST TERM CONDO": "48",
  "STORE/OFF/RES CONDO": "12",
  "VACANT COMMERCIAL LAND": "10",
  "MFR 5 TO 9 UNITS": "08",
  "MULTIFAMILY < 5 UNITS": "08",
  VACANT: "00",
  "OFFICE BLDG-NON MEDICAL 1 TO 3 STORIES": "17",
};

/**
 * "REFERENCE FOLIO" de Miami-Dade NO esta en el mapa a proposito: no es una
 * propiedad, es un folio de referencia del catastro. Sin codigo queda sin
 * clasificar, y la compuerta lo manda a revisar en vez de tragarlo en silencio.
 */

/** Codigo DOR de dos digitos, venga como numero, como "(DOR NN)" o como texto de condado. */
export function toDorCode(value?: string | null): string | undefined {
  if (!value) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;
  if (/^\d{1,2}$/.test(raw)) return raw.padStart(2, "0");
  const sufijo = raw.match(/\(DOR (\d{2})\)/)?.[1];
  if (sufijo) return sufijo;
  const categoria = raw.toUpperCase().split(" : ")[0].trim();
  return MIAMI_DADE_USE_TO_DOR[categoria] ?? PALM_BEACH_USE_TO_DOR[categoria];
}

export function isNonAcquirableDorCode(value?: string | null): boolean {
  const code = toDorCode(value);
  return code ? NON_ACQUIRABLE_CODES.has(code) : false;
}

/** Tierra publica candidata a P3: no es ruido, tiene carril propio. */
export function isGovP3DorCode(value?: string | null): boolean {
  const code = toDorCode(value);
  return code ? GOV_P3_CODES.has(code) : false;
}
