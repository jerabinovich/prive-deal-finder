async function fetchArcgisQuery(serviceUrl: string, limit: number, whereClause: string) {
  const trimmed = serviceUrl.replace(/\/+$/, "");
  const layerUrl = /\/\d+$/.test(trimmed) ? trimmed : `${trimmed}/0`;
  const queryUrl =
    `${layerUrl}/query?where=${encodeURIComponent(whereClause)}` +
    `&outFields=*&f=json&returnGeometry=true&outSR=4326&resultRecordCount=${limit}`;
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

export async function fetchArcgisSample(serviceUrl: string, limit = 50, whereClause = "1=1") {
  return fetchArcgisQuery(serviceUrl, limit, whereClause);
}

export async function fetchArcgisWhere(serviceUrl: string, whereClause: string, limit = 50) {
  return fetchArcgisQuery(serviceUrl, limit, whereClause);
}
