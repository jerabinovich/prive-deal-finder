import { fetchArcgisSample } from "./arcgis";
import {
  HealthStatus,
  IntegrationAccessMethod,
  IntegrationConnector,
  IntegrationStatus,
  SyncResult,
} from "./types";

export class PalmBeachParcelsConnector implements IntegrationConnector {
  source = "palm-beach-parcels";
  displayName = "Palm Beach Parcels (ArcGIS)";
  category = "GIS / Parcels";
  accessMethod = IntegrationAccessMethod.API_REST;
  authType = "Public endpoint";
  cadence = "Near real-time";
  requiredEnv = ["PALM_BEACH_PARCELS_URL"];

  async sync(): Promise<SyncResult> {
    const url = process.env.PALM_BEACH_PARCELS_URL;
    if (!url) {
      return { status: IntegrationStatus.NEEDS_CONFIG, message: "PALM_BEACH_PARCELS_URL missing" };
    }
    try {
      const limit = Number(process.env.ARCGIS_MAX_ROWS || 50);
      const records = await fetchArcgisSample(url, limit, "PARID IS NOT NULL AND SITE_ADDR_STR IS NOT NULL");
      return { status: IntegrationStatus.OK, message: "Palm Beach parcels reachable", records };
    } catch (_error) {
      return { status: IntegrationStatus.ERROR, message: "Palm Beach parcels fetch failed" };
    }
  }

  async getHealthStatus(): Promise<HealthStatus> {
    const result = await this.sync();
    return { status: result.status, message: result.message };
  }
}
