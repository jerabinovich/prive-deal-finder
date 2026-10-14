import { fetchArcgisPagina } from "../arcgis-pagina";
import { claveConsulta, parcelasPorCorrida, posicionDe, siguienteCursor, whereMiamiDade, zipsDeCorredores } from "../parcelas-corredores";
import {
  ContextoSync,
  HealthStatus,
  IntegrationAccessMethod,
  IntegrationConnector,
  IntegrationStatus,
  SyncResult,
} from "./types";

/** Capa de parcelas de Miami-Dade que responde consultas (596.666 parcelas, pagina y ordena por folio). */
export const CAPA_MIAMI_DADE = "https://gisweb.miamidade.gov/arcgis/rest/services/MD_Emaps/MapServer/72";

/**
 * 14-oct-2026: MIAMI_DADE_PARCELS_URL apuntaba a un enlace de descarga del portal de datos abiertos, que como
 * consulta da 404; cada corrida fallaba ahi y caia a la capa de respaldo. Solo se usa si es una capa de consulta
 * (MapServer o FeatureServer con numero de capa).
 */
export function capaMiamiDade(configurada = process.env.MIAMI_DADE_PARCELS_URL): string {
  const url = (configurada ?? "").trim();
  return /\/(MapServer|FeatureServer)\/\d+\/?$/i.test(url) ? url.replace(/\/+$/, "") : CAPA_MIAMI_DADE;
}

function describeError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown error";
}

export class MiamiDadeParcelsConnector implements IntegrationConnector {
  source = "miami-dade-parcels";
  displayName = "Miami-Dade Parcels (ArcGIS)";
  category = "GIS / Parcels";
  accessMethod = IntegrationAccessMethod.API_REST;
  authType = "Public endpoint";
  cadence = "Near real-time";
  requiredEnv = [];

  /** Pagina siguiente de las parcelas del buy box en los corredores (parcelas-corredores.ts). */
  async sync(contexto?: ContextoSync): Promise<SyncResult> {
    const capa = capaMiamiDade();
    let zips: string[];
    try {
      zips = zipsDeCorredores();
    } catch (error) {
      return { status: IntegrationStatus.ERROR, message: `Miami-Dade parcels: no corridors (${describeError(error)})` };
    }
    const where = whereMiamiDade(zips);
    const clave = claveConsulta(capa, where);
    const cantidad = parcelasPorCorrida();
    let { offset, vueltas } = posicionDe(contexto?.cursor, clave);
    try {
      let records = await fetchArcgisPagina(capa, where, { offset, cantidad, orden: "FOLIO" });
      if (!records.length && offset > 0) {
        // El recorrido termino justo en el borde de una pagina: se vuelve al principio en la misma corrida.
        offset = 0;
        vueltas += 1;
        records = await fetchArcgisPagina(capa, where, { offset, cantidad, orden: "FOLIO" });
      }
      return {
        status: IntegrationStatus.OK,
        message: `Miami-Dade parcels: corridor page of ${records.length} from ${offset}`,
        records,
        cursor: siguienteCursor(clave, offset, vueltas, records.length, cantidad),
        metrics: { modo: "corredores", zipsCorredores: zips.length, offset, pedidos: cantidad, vuelta: vueltas },
      };
    } catch (error) {
      return { status: IntegrationStatus.ERROR, message: `Miami-Dade parcels fetch failed: ${describeError(error)}` };
    }
  }

  /** Liviano: una sola parcela y sin cursor. El estado de la integracion no mueve el recorrido. */
  async getHealthStatus(): Promise<HealthStatus> {
    try {
      await fetchArcgisPagina(capaMiamiDade(), "FOLIO IS NOT NULL", { offset: 0, cantidad: 1, orden: "FOLIO" });
      return { status: IntegrationStatus.OK, message: "Miami-Dade parcels reachable" };
    } catch (error) {
      return { status: IntegrationStatus.ERROR, message: `Miami-Dade parcels fetch failed: ${describeError(error)}` };
    }
  }
}
