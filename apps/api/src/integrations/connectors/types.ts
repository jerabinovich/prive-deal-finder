export enum IntegrationStatus {
  OK = "OK",
  DEGRADED = "DEGRADED",
  ERROR = "ERROR",
  NEEDS_CONFIG = "NEEDS_CONFIG",
}

export enum IntegrationAccessMethod {
  API_REST = "API_REST",
  BULK_FILES = "BULK_FILES",
  PORTAL = "PORTAL",
}

export interface SyncResult {
  status: IntegrationStatus;
  message?: string;
  records?: unknown[];
  metrics?: Record<string, unknown>;
}

export interface HealthStatus {
  status: IntegrationStatus;
  message?: string;
}

export interface IntegrationConnector {
  source: string;
  displayName: string;
  category: string;
  accessMethod: IntegrationAccessMethod;
  authType: string;
  cadence: string;
  requiredEnv: string[];
  sync(): Promise<SyncResult>;
  getHealthStatus(): Promise<HealthStatus>;
}
