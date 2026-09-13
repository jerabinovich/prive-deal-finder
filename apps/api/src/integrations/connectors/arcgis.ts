async function fetchArcgisQuery(
  serviceUrl: string,
  limit: number,
  whereClause: string,
  orderByFields?: string,
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
  const queryUrl =
    `${layerUrl}/query?where=${encodeURIComponent(whereClause)}` +
    `&outFields=*&f=json&returnGeometry=true&outSR=4326&resultRecordCount=${limit}` +
    (orderByFields ? `&orderByFields=${encodeURIComponent(orderByFields)}` : "");
  const resp = await fetch(queryUrl);
  if (!resp.ok) {
    throw new Error(`ArcGIS query failed ${resp.status}`);
  }
  const data = await resp.json();
  if (data?.error?.message) {
    throw new Error(`ArcGIS query error: ${data.error.message}`);
  }
  const features = Array.isArray(data?.features) ? data.features : [];
  return features;
}

export async function fetchArcgisSample(
  serviceUrl: string,
  limit = 50,
  whereClause = "1=1",
  orderByFields?: string,
) {
  return fetchArcgisQuery(serviceUrl, limit, whereClause, orderByFields);
}

export async function fetchArcgisWhere(
  serviceUrl: string,
  whereClause: string,
  limit = 50,
  orderByFields?: string,
) {
  return fetchArcgisQuery(serviceUrl, limit, whereClause, orderByFields);
}
