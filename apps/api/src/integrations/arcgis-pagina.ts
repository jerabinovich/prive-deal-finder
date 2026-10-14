/**
 * Una pagina de una capa ArcGIS, por POST (14-oct-2026).
 *
 * Los filtros del sync por corredores (31 zips y los usos del buy box) no entran en una URL: un servidor IIS corta
 * el query string en 2048 caracteres. El orden es obligatorio: sin orderByFields la paginacion no es estable y
 * BCPA_INFO, que no tiene OID, la rechaza.
 */
export async function fetchArcgisPagina(
  capaUrl: string,
  where: string,
  opciones: { offset: number; cantidad: number; orden: string; geometria?: boolean },
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
  const respuesta = await fetch(`${capa}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parametros).toString(),
  });
  if (!respuesta.ok) throw new Error(`ArcGIS query failed ${respuesta.status}`);
  const cuerpo = (await respuesta.json()) as { error?: { message?: string }; features?: unknown[] };
  if (cuerpo?.error) throw new Error(`ArcGIS query error: ${cuerpo.error.message ?? "sin detalle"}`);
  return Array.isArray(cuerpo?.features) ? cuerpo.features : [];
}
