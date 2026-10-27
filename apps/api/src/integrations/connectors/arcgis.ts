import { consultarCapa } from "../arcgis-pagina";
async function fetchArcgisQuery(
  serviceUrl: string,
  limit: number,
  whereClause: string,
  orderByFields?: string,
  plazoMs?: number,
) {
  const trimmed = serviceUrl.replace(/\/+$/, "");
  const layerUrl = /\/\d+$/.test(trimmed) ? trimmed : `${trimmed}/0`;
  // 13-sep-2026: la tabla BCPA_INFO del Property Appraiser de Broward no tiene
  // campo OID, y ArcGIS entonces rechaza resultRecordCount con "Pagination
  // request requires either orderBy field or the layer/table needs to have OID
  // Field". Necesita orderByFields.
  // VA POR CONECTOR, NO POR ENV GLOBAL: lo probe con una variable global
  // (ARCGIS_ORDER_BY=FOLIO_NUMBER) y rompi Palm Beach y Miami-Dade en el acto,
  // porque ese campo no existe en sus capas. Cada fuente ordena por lo suyo.
  // 25-oct-2026: el pedido lo hace el cliente unico (consultarCapa, arcgis-pagina.ts), por GET y con los mismos
  // parametros en el mismo orden que antes; el plazo de 120 s sigue saliendo de ahi.
  const parametros: Record<string, string> = {
    where: whereClause,
    outFields: "*",
    f: "json",
    returnGeometry: "true",
    outSR: "4326",
    resultRecordCount: String(limit),
  };
  if (orderByFields) parametros.orderByFields = orderByFields;
  return consultarCapa(layerUrl, parametros, { metodo: "GET", plazoMs });
}

export async function fetchArcgisSample(
  serviceUrl: string,
  limit = 50,
  whereClause = "1=1",
  orderByFields?: string,
  plazoMs?: number,
) {
  return fetchArcgisQuery(serviceUrl, limit, whereClause, orderByFields, plazoMs);
}

export async function fetchArcgisWhere(
  serviceUrl: string,
  whereClause: string,
  limit = 50,
  orderByFields?: string,
  plazoMs?: number,
) {
  return fetchArcgisQuery(serviceUrl, limit, whereClause, orderByFields, plazoMs);
}
