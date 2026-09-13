import { fetchArcgisSample } from "./arcgis";
import {
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

  async sync(): Promise<SyncResult> {
    const url = process.env.BROWARD_PARCELS_URL;
    if (!url) {
      return { status: IntegrationStatus.NEEDS_CONFIG, message: "BROWARD_PARCELS_URL missing" };
    }
    try {
      const limit = Number(process.env.ARCGIS_MAX_ROWS || 50);
      // BCPA_INFO no tiene OID: sin orderByFields, ArcGIS rechaza la paginacion.
      const records = await fetchArcgisSample(
        url, limit, "FOLIO_NUMBER IS NOT NULL AND SITUS_CITY IS NOT NULL", "FOLIO_NUMBER",
      );
      return { status: IntegrationStatus.OK, message: "Broward parcels reachable", records };
    } catch (_error) {
      return { status: IntegrationStatus.ERROR, message: "Broward parcels fetch failed" };
    }
  }

  async getHealthStatus(): Promise<HealthStatus> {
    const result = await this.sync();
    return { status: result.status, message: result.message };
  }
}
