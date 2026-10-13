/**
 * El Property Appraiser de Broward guarda la ciudad del sitio como codigo de dos letras (SITUS_CITY).
 * Mapa MEDIDO el 13-oct-2026, no copiado de memoria: para cada codigo se tomaron 8 parcelas de muestra,
 * el centro de su poligono (capa Parcels del mismo servicio) y se cruzo con la capa City Limits. "BC" cae
 * en el BMSD (Broward Municipal Services District): zona no incorporada. Un codigo que no esta aca se
 * deja como vino.
 */
export const CIUDADES_BROWARD: Readonly<Record<string, string>> = {
  BC: "Unincorporated Broward",
  CK: "Coconut Creek",
  CS: "Coral Springs",
  CY: "Cooper City",
  DB: "Deerfield Beach",
  DN: "Dania Beach",
  DV: "Davie",
  FL: "Fort Lauderdale",
  HA: "Hallandale Beach",
  HB: "Hillsboro Beach",
  HW: "Hollywood",
  LH: "Lauderhill",
  LL: "Lauderdale Lakes",
  LP: "Lighthouse Point",
  LS: "Lauderdale By The Sea",
  LZ: "Lazy Lake",
  MG: "Margate",
  MM: "Miramar",
  NL: "North Lauderdale",
  OP: "Oakland Park",
  PA: "Parkland",
  PB: "Pompano Beach",
  PI: "Pembroke Pines",
  PK: "Pembroke Park",
  PL: "Plantation",
  SU: "Sunrise",
  SW: "Southwest Ranches",
  TM: "Tamarac",
  WM: "Wilton Manors",
  WP: "West Park",
  WS: "Weston",
};

const normalizar = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, "");

/** "WM" da "Wilton Manors"; un codigo desconocido o vacio da null. */
export function ciudadBroward(codigo?: string | null): string | null {
  const c = String(codigo ?? "").trim().toUpperCase();
  return CIUDADES_BROWARD[c] ?? null;
}

/** "City of Wilton Manors" o "WILTON MANORS" dan "WM". */
export function codigoCiudadBroward(nombre?: string | null): string | null {
  const n = normalizar(String(nombre ?? "").replace(/^\s*(CITY|TOWN|VILLAGE)\s+OF\s+/i, ""));
  if (!n) return null;
  for (const [codigo, ciudad] of Object.entries(CIUDADES_BROWARD)) {
    if (normalizar(ciudad) === n) return codigo;
  }
  return null;
}
