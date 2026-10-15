import { parcelasPorCorrida } from "../parcelas-corredores";
import { CondadoEstatal, recorrerCondado, rangoDelCondado } from "../parcelas-estatales";
import {
  ContextoSync,
  HealthStatus,
  IntegrationAccessMethod,
  IntegrationConnector,
  IntegrationStatus,
  SyncResult,
} from "./types";

function describeError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown error";
}

/**
 * 15-oct-2026: parcelas de Martin y Monroe por el catastro estatal (parcelas-estatales.ts). Un conector por condado,
 * con el mismo recorrido por corredores que Miami-Dade, Broward y Palm Beach: la pagina siguiente de las parcelas del
 * buy box en los corredores de buybox.json, con el cursor en Integration.meta.
 */
export class CatastroEstatalParcelsConnector implements IntegrationConnector {
  source: string;
  displayName: string;
  category = "GIS / Parcels";
  accessMethod = IntegrationAccessMethod.API_REST;
  authType = "Public endpoint";
  cadence = "Daily";
  requiredEnv: string[] = [];

  constructor(private readonly cfg: CondadoEstatal) {
    this.source = cfg.source;
    this.displayName = `${cfg.nombre} Parcels (Florida statewide cadastral)`;
  }

  async sync(contexto?: ContextoSync): Promise<SyncResult> {
    const nombre = `${this.cfg.nombre} parcels`;
    try {
      const r = await recorrerCondado(this.cfg, contexto?.cursor, { cantidad: parcelasPorCorrida() });
      return {
        status: IntegrationStatus.OK,
        message: `${nombre}: corridor page of ${r.records.length} (read ${r.leidos}) from ${r.desde}`,
        records: r.records,
        cursor: r.cursor,
        metrics: {
          modo: "corredores",
          condado: this.cfg.condado,
          offset: r.desde,
          pedidos: parcelasPorCorrida(),
          leidos: r.leidos,
          tramos: r.tramos,
          fueraDelCorredor: r.fueraDelCorredor,
          fueraDelBuyBox: r.fueraDelBuyBox,
          repetidas: r.repetidas,
          porCorredor: r.porCorredor,
          vuelta: r.vuelta,
        },
      };
    } catch (error) {
      return { status: IntegrationStatus.ERROR, message: `${nombre} fetch failed: ${describeError(error)}` };
    }
  }

  /** Liviano: el rango del condado en la capa, sin cursor. */
  async getHealthStatus(): Promise<HealthStatus> {
    try {
      const rango = await rangoDelCondado(this.cfg);
      return { status: IntegrationStatus.OK, message: `${this.cfg.nombre} parcels reachable (${rango.n} parcels)` };
    } catch (error) {
      return { status: IntegrationStatus.ERROR, message: `${this.cfg.nombre} parcels fetch failed: ${describeError(error)}` };
    }
  }
}
