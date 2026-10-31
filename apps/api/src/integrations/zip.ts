/**
 * CODIGO POSTAL DEL SITIO, de 5 digitos (12-oct-2026).
 *
 * Que estaba mal, medido en la base del 12-oct (440 deals):
 *   - Miami-Dade guardaba "33132-0000": TRUE_SITE_ZIP_CODE trae ZIP+4 (220 deals).
 *   - Broward guardaba 9 digitos pegados ("333231640", 43 deals) y "0" (26 deals), que es como
 *     el Property Appraiser dice "no se sabe".
 *   - Palm Beach guardaba el codigo postal del DUENO: la capa de parcelas de PBC no trae zip del
 *     sitio, y la cadena de campos caia en ZIP1 o PSTLZIP5, que son la direccion postal del
 *     propietario. 547 17TH ST, West Palm Beach, quedaba con 33020 (Hollywood). Con el lujo por
 *     locacion, eso dispara o esconde corredores al azar.
 *
 * Regla: solo campos del SITIO, y el resultado son 5 digitos o null. Donde la capa no trae zip del
 * sitio, sale de las coordenadas de la parcela contra las ZCTA del Census. Sin dato confiable,
 * null: no se adivina.
 */

/** Campos del zip del SITIO. Fuera ZIP1 y PSTLZIP5: en Palm Beach son del dueno. */
export const CAMPOS_ZIP_DEL_SITIO = ["SITUS_ZIP", "SITUS_ZIP_CODE", "TRUE_SITE_ZIP_CODE", "ZIP", "ZIPCODE"];

/** Campos de la ciudad del SITIO. Fuera CITYNAME y PSTLCITY: en Palm Beach son del dueno. */
export const CAMPOS_CIUDAD_DEL_SITIO = ["SITUS_CITY", "CITY", "MUNICIPALITY", "TRUE_SITE_CITY"];

/** "33132-0000", "333231640" o 33132 dan "33132"; "0", "00000", vacio o basura dan null. */
export function normalizarZip(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim().replace(/\.0+$/, "");
  const m = /^(\d{5})(?:-?\d{4})?$/.exec(texto);
  if (!m || m[1] === "00000") return null;
  return m[1];
}

const CENSUS = "https://geocoding.geo.census.gov/geocoder/geographies/coordinates";
const CAPA_ZCTA = "2020 Census ZIP Code Tabulation Areas";
const cachePorPunto = new Map<string, string | null>();

/**
 * 31-oct-2026: corte del Census. Despues de FALLAS_PARA_CORTAR consultas seguidas sin respuesta, no se le pregunta
 * por PAUSA_MS: cada consulta espera hasta 8 s y una corrida de 500 parcelas nuevas tardaria mas de una hora. Lo que
 * queda sin zip lo completa la proxima corrida. "No hay ZCTA" es una respuesta, no una falla.
 */
export const FALLAS_PARA_CORTAR = 3;
export const PAUSA_MS = 15 * 60 * 1000;
let fallasSeguidas = 0;
let pausaHasta = 0;

/** Solo para las pruebas: vuelve el corte a cero. */
export function reiniciarCorteCensus(): void {
  fallasSeguidas = 0;
  pausaHasta = 0;
}

function anotarFalla(): void {
  fallasSeguidas += 1;
  if (fallasSeguidas >= FALLAS_PARA_CORTAR) {
    pausaHasta = Date.now() + PAUSA_MS;
    fallasSeguidas = 0;
  }
}

/**
 * 31-oct-2026: el zip que la parcela ya tiene guardado, si sus coordenadas son las mismas (a 6 decimales, la misma
 * clave que la cache del Census). Si se movio, no tiene zip o no tiene coordenadas, null: hay que consultar.
 */
export function zipGuardado(
  deal: { zip?: string | null; latitude?: number | null; longitude?: number | null } | null | undefined,
  lat: number | null | undefined,
  lon: number | null | undefined,
): string | null {
  const zip = normalizarZip(deal?.zip);
  if (!zip || !deal) return null;
  const mismo = (a: number | null | undefined, b: number | null | undefined) =>
    typeof a === "number" && typeof b === "number" && Number.isFinite(a) && Number.isFinite(b) && a.toFixed(6) === b.toFixed(6);
  return mismo(deal.latitude, lat) && mismo(deal.longitude, lon) ? zip : null;
}

/**
 * La respuesta del Census para el punto: si contesto y, si contesto, el zip (null si el punto no cae en
 * ninguna ZCTA, como pasa en zonas sin poblacion de los Everglades). Nunca tira. Las fallas de red no se
 * guardan en cache: la proxima corrida vuelve a intentar. 13-oct-2026: separa "no contesto" de "no hay
 * ZCTA", que zipPorCoordenadas devolvia igual (null).
 */
export async function consultarZcta(
  lat: number | null | undefined,
  lon: number | null | undefined,
  timeoutMs = 8000,
): Promise<{ respondio: boolean; zip: string | null }> {
  if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { respondio: false, zip: null };
  }
  const clave = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  if (cachePorPunto.has(clave)) return { respondio: true, zip: cachePorPunto.get(clave) ?? null };
  if (Date.now() < pausaHasta) return { respondio: false, zip: null };
  const url =
    `${CENSUS}?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current` +
    `&layers=${encodeURIComponent(CAPA_ZCTA)}&format=json`;
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), timeoutMs);
  try {
    const respuesta = await fetch(url, { signal: control.signal });
    if (!respuesta.ok) {
      anotarFalla();
      return { respondio: false, zip: null };
    }
    const cuerpo = (await respuesta.json()) as {
      result?: { geographies?: Record<string, Array<Record<string, unknown>>> };
    };
    if (!cuerpo.result?.geographies) {
      anotarFalla();
      return { respondio: false, zip: null };
    }
    fallasSeguidas = 0;
    const capas = cuerpo.result.geographies;
    const zcta = Object.entries(capas).find(([nombre]) => /ZIP Code Tabulation/i.test(nombre))?.[1] ?? [];
    const zip = normalizarZip(zcta[0]?.ZCTA5 ?? zcta[0]?.BASENAME);
    cachePorPunto.set(clave, zip);
    return { respondio: true, zip };
  } catch {
    anotarFalla();
    return { respondio: false, zip: null };
  } finally {
    clearTimeout(reloj);
  }
}

/** El codigo postal (ZCTA del Census) del punto. null si no hay respuesta util; nunca tira. */
export async function zipPorCoordenadas(
  lat: number | null | undefined,
  lon: number | null | undefined,
  timeoutMs = 8000,
): Promise<string | null> {
  return (await consultarZcta(lat, lon, timeoutMs)).zip;
}

/** El zip del sitio: el de la capa si es valido; si no, el de las coordenadas; si no, null. */
export async function resolverZipDelSitio(
  zipDeLaCapa: unknown,
  lat?: number | null,
  lon?: number | null,
): Promise<string | null> {
  return normalizarZip(zipDeLaCapa) ?? (await zipPorCoordenadas(lat, lon));
}
