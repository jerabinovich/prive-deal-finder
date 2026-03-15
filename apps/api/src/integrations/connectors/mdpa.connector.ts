import {
  HealthStatus,
  IntegrationAccessMethod,
  IntegrationConnector,
  IntegrationStatus,
  SyncResult,
} from "./types";
import { resolveMdpaBulkFilePath } from "../mdpa.path";

export class MdpaConnector implements IntegrationConnector {
  source = "mdpa";
  displayName = "Miami-Dade Property Appraiser (MDPA)";
  category = "Property / Assessor";
  accessMethod = IntegrationAccessMethod.BULK_FILES;
  authType = "Portal account + credits";
  cadence = "Weekly";
  requiredEnv = ["MDPA_BULK_FILE_PATH"];

  async sync(): Promise<SyncResult> {
    const { resolvedPath, checkedPaths } = resolveMdpaBulkFilePath(process.env.MDPA_BULK_FILE_PATH);
    if (!resolvedPath) {
      return {
        status: IntegrationStatus.NEEDS_CONFIG,
        message: `MDPA bulk file not found. Checked: ${checkedPaths.join(", ")}`,
      };
    }
    return { status: IntegrationStatus.OK, message: "MDPA bulk file ready for ingestion" };
  }

  async getHealthStatus(): Promise<HealthStatus> {
    const result = await this.sync();
    return { status: result.status, message: result.message };
  }
}
