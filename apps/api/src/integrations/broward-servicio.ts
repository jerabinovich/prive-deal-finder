import { fetchArcgisPagina } from "./arcgis-pagina";

/**
 * EL SERVICIO DEL ROL VIGENTE DE BROWARD (15-oct-2026).
 *
 * BROWARD_PARCELS_URL apunta a BCPA_EXTERNAL_JAN26/MapServer/36. El Property Appraiser publica un servicio por
 * rol (hoy conviven BCPA_EXTERNAL_JAN25 y BCPA_EXTERNAL_JAN26) y el numero de la tabla cambia de uno a otro:
 * BCPA_INFO es la 35 en JAN25 y la 36 en JAN26 (medido el 15 oct). Con la URL fija, el sync se quedaba en el rol
 * viejo cuando saliera JAN27, o se cortaba el dia que sacaran JAN26. Ahora se usa el BCPA_EXTERNAL mas nuevo del
 * directorio y, adentro, la tabla con el mismo nombre que la configurada, probada con una consulta. Si algo no
 * responde o no coincide, queda la configurada. La respuesta se guarda 12 horas (1 hora si hubo un problema).
 */
const RE_SERVICIO = /^BCPA_EXTERNAL_([A-Z]{3})(\d{2})$/i;
const MESES: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};
const VIGENCIA_MS = 12 * 60 * 60 * 1000;
const VIGENCIA_PROBLEMA_MS = 60 * 60 * 1000;
let guardada: { configurada: string; url: string; hasta: number } | null = null;

/** El BCPA_EXTERNAL de rol mas nuevo, por el ano y el mes del nombre. null si no hay ninguno. */
export function servicioMasNuevo(nombres: string[]): string | null {
  let mejor: { nombre: string; orden: number } | null = null;
  for (const n of nombres) {
    const nombre = String(n ?? "").trim();
    const m = RE_SERVICIO.exec(nombre);
    const mes = m ? MESES[m[1].toUpperCase()] : undefined;
    if (!m || !mes) continue;
    const orden = Number(m[2]) * 100 + mes;
    if (!mejor || orden > mejor.orden) mejor = { nombre, orden };
  }
  return mejor?.nombre ?? null;
}

/** Parte la URL de una capa: directorio de servicios, nombre del servicio y numero de capa. */
export function partesDeCapa(url: string): { directorio: string; servicio: string; capa: number } | null {
  const m = /^(https?:\/\/.+\/rest\/services)\/([^/]+)\/MapServer\/(\d+)\/?$/i.exec(url.trim());
  return m ? { directorio: m[1], servicio: m[2], capa: Number(m[3]) } : null;
}

/** "SQLGIS02.dbo.BCPA_INFO" y "BCPA_INFO" son la misma tabla. */
const sinPrefijo = (nombre: unknown) => (String(nombre ?? "").trim().toUpperCase().split(".").pop() ?? "").trim();

async function leerJson(url: string): Promise<Record<string, unknown>> {
  const respuesta = await fetch(url);
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  const cuerpo = (await respuesta.json()) as Record<string, unknown>;
  if (cuerpo && typeof cuerpo === "object" && "error" in cuerpo) throw new Error("ArcGIS error");
  return cuerpo;
}

/** Solo para las pruebas: olvida la respuesta guardada. */
export function olvidarServicioBroward(): void {
  guardada = null;
}

/** La URL de BCPA_INFO en el servicio del rol mas nuevo; la configurada si no se puede resolver. */
export async function urlTablaBroward(configurada = process.env.BROWARD_PARCELS_URL): Promise<string | undefined> {
  if (!configurada) return undefined;
  const ahora = Date.now();
  if (guardada && guardada.configurada === configurada && guardada.hasta > ahora) return guardada.url;
  const recordar = (url: string, vigencia = VIGENCIA_MS) => {
    guardada = { configurada, url, hasta: ahora + vigencia };
    return url;
  };
  const partes = partesDeCapa(configurada);
  if (!partes || !RE_SERVICIO.test(partes.servicio)) return recordar(configurada);
  try {
    const directorio = await leerJson(`${partes.directorio}?f=json`);
    const nombres = ((directorio.services as Array<{ name?: string }> | undefined) ?? []).map((s) => String(s?.name ?? ""));
    const nuevo = servicioMasNuevo(nombres);
    if (!nuevo || nuevo.toUpperCase() === partes.servicio.toUpperCase()) return recordar(configurada);
    const capa = await leerJson(`${configurada.trim().replace(/\/+$/, "")}?f=json`);
    const nombre = sinPrefijo(capa.name);
    const servicio = await leerJson(`${partes.directorio}/${nuevo}/MapServer?f=json`);
    const todas = [
      ...((servicio.layers as Array<{ id?: number; name?: string }> | undefined) ?? []),
      ...((servicio.tables as Array<{ id?: number; name?: string }> | undefined) ?? []),
    ];
    const iguales = todas.filter((l) => typeof l.id === "number" && sinPrefijo(l.name) === nombre);
    if (!nombre || iguales.length !== 1) return recordar(configurada, VIGENCIA_PROBLEMA_MS);
    const url = `${partes.directorio}/${nuevo}/MapServer/${iguales[0].id}`;
    await fetchArcgisPagina(url, "FOLIO_NUMBER IS NOT NULL", { offset: 0, cantidad: 1, orden: "FOLIO_NUMBER", geometria: false });
    return recordar(url);
  } catch {
    return recordar(configurada, VIGENCIA_PROBLEMA_MS);
  }
}
