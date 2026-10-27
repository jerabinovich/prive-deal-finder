import type { CursorParcelas } from "../parcelas-corredores";

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
  /** 14-oct-2026: proxima posicion del recorrido de parcelas; el servicio la guarda despues de ingerir. */
  cursor?: CursorParcelas;
  /** 26-oct-2026: estado propio del conector (Integration.meta.estadoConector); el servicio lo guarda si la corrida
   *  termina OK, despues de ingerir. Lo usa Broward foreclosure para no perder fechas (revision de Codex del PR 23). */
  estado?: EstadoConector;
}

export type EstadoConector = Record<string, unknown>;

/** 14-oct-2026: lo que el servicio le pasa al conector en cada sync. */
export interface ContextoSync {
  cursor?: CursorParcelas | null;
  estado?: EstadoConector | null;
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
  sync(contexto?: ContextoSync): Promise<SyncResult>;
  getHealthStatus(): Promise<HealthStatus>;
}
