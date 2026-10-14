import { normalizarRegistrosBroward } from "../broward-parcelas";
import { fetchArcgisPagina } from "../arcgis-pagina";
import { claveConsulta, parcelasPorCorrida, posicionDe, siguienteCursor, whereBroward, zipsDeCorredores } from "../parcelas-corredores";
import {
  ContextoSync,
  HealthStatus,
  IntegrationAccessMethod,
  IntegrationConnector,
  IntegrationStatus,
  SyncResult,
} from "./types";

export class BrowardParcelsConnector implements IntegrationConnector {
  source = "broward-parcels";
  displayName = "Broward Parcels (ArcGIS)";
  category = "GIS / Parcels";
  accessMethod = IntegrationAccessMethod.API_REST;
  authType = "Public endpoint";
  cadence = "Near real-time";
  requiredEnv = ["BROWARD_PARCELS_URL"];

  /**
   * 14-oct-2026: pagina siguiente de las parcelas del buy box en los corredores (parcelas-corredores.ts), por
   * FOLIO_NUMBER: BCPA_INFO no tiene OID y sin orden rechaza la paginacion. Es una tabla, sin geometria.
   */
  async sync(contexto?: ContextoSync): Promise<SyncResult> {
    const url = process.env.BROWARD_PARCELS_URL;
    if (!url) {
      return { status: IntegrationStatus.NEEDS_CONFIG, message: "BROWARD_PARCELS_URL missing" };
    }
    let zips: string[];
    try {
      zips = zipsDeCorredores();
    } catch (error) {
      return { status: IntegrationStatus.ERROR, message: `Broward parcels: no corridors (${error instanceof Error ? error.message : String(error)})` };
    }
    const where = whereBroward(zips);
    const clave = claveConsulta(url, where);
    const cantidad = parcelasPorCorrida();
    let { offset, vueltas } = posicionDe(contexto?.cursor, clave);
    try {
      const pagina = (desde: number) =>
        fetchArcgisPagina(url, where, { offset: desde, cantidad, orden: "FOLIO_NUMBER", geometria: false });
      let records = await pagina(offset);
      if (!records.length && offset > 0) {
        offset = 0;
        vueltas += 1;
        records = await pagina(offset);
      }
      // 13-oct-2026: la tabla no trae geometria y la ciudad viene en codigo; se normaliza aca, en la fuente.
      const normalizados = await normalizarRegistrosBroward(url, records);
      return {
        status: IntegrationStatus.OK,
        message: `Broward parcels: corridor page of ${records.length} from ${offset}`,
        records: normalizados,
        cursor: siguienteCursor(clave, offset, vueltas, records.length, cantidad),
        metrics: { modo: "corredores", zipsCorredores: zips.length, offset, pedidos: cantidad, vuelta: vueltas },
      };
    } catch (_error) {
      return { status: IntegrationStatus.ERROR, message: "Broward parcels fetch failed" };
    }
  }

  /** Liviano: una sola parcela y sin cursor. */
  async getHealthStatus(): Promise<HealthStatus> {
    const url = process.env.BROWARD_PARCELS_URL;
    if (!url) return { status: IntegrationStatus.NEEDS_CONFIG, message: "BROWARD_PARCELS_URL missing" };
    try {
      await fetchArcgisPagina(url, "FOLIO_NUMBER IS NOT NULL", { offset: 0, cantidad: 1, orden: "FOLIO_NUMBER", geometria: false });
      return { status: IntegrationStatus.OK, message: "Broward parcels reachable" };
    } catch (_error) {
      return { status: IntegrationStatus.ERROR, message: "Broward parcels fetch failed" };
    }
  }
}
