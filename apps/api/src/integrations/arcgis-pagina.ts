/**
 * Una pagina de una capa ArcGIS, por POST (14-oct-2026).
 *
 * Los filtros del sync por corredores (31 zips y los usos del buy box) no entran en una URL: un servidor IIS corta
 * el query string en 2048 caracteres. El orden es obligatorio: sin orderByFields la paginacion no es estable y
 * BCPA_INFO, que no tiene OID, la rechaza.
 */
/**
 * 25-oct-2026: plazo por pedido. Sin plazo, una respuesta que nunca llega colgaba la corrida (el 23-oct, 30 minutos en
 * catastro-valores). 120 s: la corrida de parcelas mas larga de los 14 dias medidos tardo 82 s en total, con varios
 * pedidos adentro.
 */
export const PLAZO_ARCGIS_MS = 120_000;

/** fetch con plazo: si la capa no responde a tiempo, falla con un error que lo dice. */
export async function fetchConPlazo(url: string, init: RequestInit, plazoMs = PLAZO_ARCGIS_MS): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(plazoMs) });
  } catch (e) {
    const nombre = (e as { name?: string })?.name;
    if (nombre === "TimeoutError" || nombre === "AbortError") {
      throw new Error(`ArcGIS sin respuesta en ${Math.round(plazoMs / 1000)} s: ${url.split("?")[0]}`);
    }
    throw e;
  }
}

export async function fetchArcgisPagina(
  capaUrl: string,
  where: string,
  opciones: { offset: number; cantidad: number; orden: string; geometria?: boolean; plazoMs?: number },
): Promise<unknown[]> {
  const capa = capaUrl.trim().replace(/\/+$/, "");
  const parametros: Record<string, string> = {
    where,
    outFields: "*",
    f: "json",
    orderByFields: opciones.orden,
    resultOffset: String(Math.max(0, Math.floor(opciones.offset))),
    resultRecordCount: String(Math.max(1, Math.floor(opciones.cantidad))),
    returnGeometry: opciones.geometria === false ? "false" : "true",
  };
  if (opciones.geometria !== false) parametros.outSR = "4326";
  const respuesta = await fetchConPlazo(`${capa}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parametros).toString(),
  }, opciones.plazoMs);
  if (!respuesta.ok) throw new Error(`ArcGIS query failed ${respuesta.status}`);
  const cuerpo = (await respuesta.json()) as { error?: { message?: string }; features?: unknown[] };
  if (cuerpo?.error) throw new Error(`ArcGIS query error: ${cuerpo.error.message ?? "sin detalle"}`);
  return Array.isArray(cuerpo?.features) ? cuerpo.features : [];
}
