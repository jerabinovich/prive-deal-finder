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

/**
 * Pide y lee la respuesta JSON con plazo: si la capa no responde a tiempo (encabezados o cuerpo), falla con un error
 * que lo dice. Revision del PR 18: el corte durante la lectura del cuerpo salia como el TimeoutError crudo de Node.
 */
export async function jsonConPlazo(url: string, init: RequestInit, plazoMs = PLAZO_ARCGIS_MS): Promise<unknown> {
  try {
    const respuesta = await fetch(url, { ...init, signal: AbortSignal.timeout(plazoMs) });
    if (!respuesta.ok) throw new Error(`ArcGIS query failed ${respuesta.status}`);
    return await respuesta.json();
  } catch (e) {
    const nombre = (e as { name?: string })?.name;
    if (nombre === "TimeoutError" || nombre === "AbortError") {
      throw new Error(`ArcGIS sin respuesta en ${Math.round(plazoMs / 1000)} s: ${url.split("?")[0]}`);
    }
    throw e;
  }
}

/**
 * CLIENTE ARCGIS UNICO (25-oct-2026, cowork-1025-cierres, pendiente de la revision del PR 13; pedido de JR).
 *
 * Habia tres clientes que armaban la consulta cada uno a su manera: fetchArcgisQuery (connectors/arcgis.ts, por GET),
 * fetchArcgisPagina (aqui, por POST) y consultaArcgis (catastro-valores.ts, por POST, con reintentos y tope de filas).
 * Cada arreglo (el plazo del 25-oct, el tope de filas, los errores) habia que hacerlo tres veces y no siempre se hacia.
 * Ahora los tres pasan por consultarCapa. Cada uno conserva lo suyo: GET o POST, los mismos parametros en el mismo
 * orden, su plazo (120 s el sync, 60 s el catastro), y solo el catastro reintenta y falla con LoteCortado.
 * Cambios a proposito: un error de la capa sin mensaje ahora falla en los conectores (antes devolvia 0 filas como si
 * la capa estuviera vacia), y los errores del catastro dicen lo mismo que los del sync ("ArcGIS query failed 500",
 * "ArcGIS query error: ...", "ArcGIS sin respuesta en 60 s").
 */
/**
 * LOTE CORTADO (25-oct-2026, hallazgo 1 de la revision del PR 13). Una capa devuelve a lo sumo maxRecordCount filas
 * (BCPA_SALES: 1.000; el catastro estatal: 2.000) y lo avisa con exceededTransferLimit. Con topeCortado, consultarCapa
 * lo rechaza con LoteCortado, sin reintentar, y las consultas por lotes de folios lo parten en dos hasta que entra.
 */
export class LoteCortado extends Error {
  constructor(url: string) {
    super(`ArcGIS corto la respuesta en su tope de filas (${url})`);
    this.name = "LoteCortado";
  }
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type OpcionesConsulta = {
  /** GET arma la consulta en la URL (los conectores); POST la manda en el cuerpo (filtros largos, IIS corta en 2048). */
  metodo?: "GET" | "POST";
  plazoMs?: number;
  /** 1 por defecto. Entre intentos espera 2 s, 4 s...; ninguna despues del ultimo. */
  intentos?: number;
  esperar?: (ms: number) => Promise<void>;
  /** Si la capa avisa exceededTransferLimit, falla con LoteCortado en vez de tomar lo que vino como si fuera todo. */
  topeCortado?: boolean;
};

/** El pedido unico a la capa: arma la consulta, aplica el plazo, lee el error de ArcGIS y devuelve las features. */
export async function consultarCapa(
  capaUrl: string,
  parametros: Record<string, string>,
  opciones: OpcionesConsulta = {},
): Promise<unknown[]> {
  const url = `${capaUrl.trim().replace(/\/+$/, "")}/query`;
  const intentos = Math.max(1, Math.floor(opciones.intentos ?? 1));
  const esperar = opciones.esperar ?? dormir;
  let ultimo: unknown;
  for (let intento = 1; intento <= intentos; intento += 1) {
    try {
      const cuerpo = (await (opciones.metodo === "GET"
        ? jsonConPlazo(
          `${url}?${Object.entries(parametros).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`,
          {},
          opciones.plazoMs,
        )
        : jsonConPlazo(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(parametros).toString(),
        }, opciones.plazoMs))) as { error?: { message?: string }; features?: unknown[]; exceededTransferLimit?: boolean };
      if (cuerpo?.error) throw new Error(`ArcGIS query error: ${cuerpo.error.message ?? "sin detalle"}`);
      if (opciones.topeCortado && cuerpo?.exceededTransferLimit) throw new LoteCortado(capaUrl);
      return Array.isArray(cuerpo?.features) ? cuerpo.features : [];
    } catch (e) {
      if (e instanceof LoteCortado) throw e;
      ultimo = e;
      if (intento < intentos) await esperar(2000 * intento);
    }
  }
  throw ultimo instanceof Error ? ultimo : new Error(String(ultimo));
}

export async function fetchArcgisPagina(
  capaUrl: string,
  where: string,
  opciones: { offset: number; cantidad: number; orden: string; geometria?: boolean; plazoMs?: number },
): Promise<unknown[]> {
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
  return consultarCapa(capaUrl, parametros, { metodo: "POST", plazoMs: opciones.plazoMs });
}
