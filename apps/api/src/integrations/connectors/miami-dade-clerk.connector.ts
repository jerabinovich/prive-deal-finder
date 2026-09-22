import {
  HealthStatus,
  IntegrationAccessMethod,
  IntegrationConnector,
  IntegrationStatus,
  SyncResult,
} from "./types";
import {
  MIAMI_DADE_CLERK_SOURCE,
  ParsedClerkResult,
  parseClerkResult,
  readClerkResultFile,
  resolveClerkResultPath,
} from "../miami-dade-clerk.debt";

export interface ClerkResultLoad {
  status: IntegrationStatus;
  message: string;
  filePath: string | null;
  parsed: ParsedClerkResult | null;
}

/**
 * Deuda registrada del Clerk de Miami-Dade, SOLO INFORMATIVA (decision de JR, 22-sep-2026).
 *
 * No habla con el Clerk: lee el resultado.json que ya pago consultar.py, en
 * prive-deal-finder-ops. Por eso no pide clave ni confirmacion de gasto, y un sync
 * (boton, chat o cron) cuesta cero unidades. El que gasta es consultar.py, con sus frenos.
 *
 * Distinto de miami-dade-foreclosure, que si consulta al Clerk con una clave propia.
 */
export class MiamiDadeClerkConnector implements IntegrationConnector {
  source = MIAMI_DADE_CLERK_SOURCE;
  displayName = "Miami-Dade Clerk: deuda registrada (informativo)";
  category = "Title / Recorded Debt";
  accessMethod = IntegrationAccessMethod.BULK_FILES;
  authType = "None (local file)";
  cadence = "Manual";
  requiredEnv: string[] = [];

  loadResult(): ClerkResultLoad {
    const { resolvedPath, checkedPaths } = resolveClerkResultPath();
    if (!resolvedPath) {
      return {
        status: IntegrationStatus.NEEDS_CONFIG,
        message: `resultado.json de consultar.py no encontrado. Revisado: ${checkedPaths.join(", ")}`,
        filePath: null,
        parsed: null,
      };
    }

    try {
      const parsed = parseClerkResult(readClerkResultFile(resolvedPath));
      const withData = parsed.snapshots.filter((item) => item.outcome === "RECORDS_FOUND").length;
      const empty = parsed.snapshots.length - withData;
      return {
        status: IntegrationStatus.OK,
        message:
          `resultado.json listo: ${withData} folios con documentos, ${empty} sin documentos, ` +
          `${parsed.skipped.length} salteados (corrida ${parsed.runAt ?? "sin fecha"})`,
        filePath: resolvedPath,
        parsed,
      };
    } catch (error) {
      return {
        status: IntegrationStatus.ERROR,
        message: error instanceof Error && error.message ? error.message : "resultado.json ilegible",
        filePath: resolvedPath,
        parsed: null,
      };
    }
  }

  // El import lo hace IntegrationsService.sync: aca no se devuelven registros, para que
  // ningun camino generico los mande a staging como SAMPLED ni al pipeline de señales.
  async sync(): Promise<SyncResult> {
    const { status, message } = this.loadResult();
    return { status, message };
  }

  async getHealthStatus(): Promise<HealthStatus> {
    const { status, message } = this.loadResult();
    return { status, message };
  }
}
