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
const NON_ACQUIRABLE_CODES = new Set<string>([
  "09",
  "80", "81", "82", "83", "84", "85", "86", "87", "88", "89",
  "91", "92", "93", "94", "95", "96", "97", "98",
]);

export function isNonAcquirableDorCode(value?: string | null): boolean {
  if (!value) return false;
  const raw = String(value).trim();
  const bare = /^\d{1,2}$/.test(raw) ? raw.padStart(2, "0") : raw.match(/\(DOR (\d{2})\)/)?.[1];
  return bare ? NON_ACQUIRABLE_CODES.has(bare) : false;
}
