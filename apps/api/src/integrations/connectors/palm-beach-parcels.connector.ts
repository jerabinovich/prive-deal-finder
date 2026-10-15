import { fetchArcgisPagina } from "../arcgis-pagina";
import { claveConsulta, parcelasPorCorrida, posicionDe, siguienteCursor } from "../parcelas-corredores";
import {
  CAPA_PALM_BEACH,
  CorredoresPalmBeach,
  corredoresPalmBeach,
  dentroDelCorredor,
  normalizarRegistroPalmBeach,
  sinRepetidas,
  wherePalmBeach,
} from "../parcelas-palm-beach";
import {
  ContextoSync,
  HealthStatus,
  IntegrationAccessMethod,
  IntegrationConnector,
  IntegrationStatus,
  SyncResult,
} from "./types";

/** La capa repite filas por parcela: OBJECTID desempata y la paginacion queda estable. */
const ORDEN = "PARCEL_NUMBER,OBJECTID";

function describeError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown error";
}

/**
 * 14-oct-2026: PALM_BEACH_PARCELS_URL apunta a la capa de la ciudad de West Palm Beach y ya no se usa. La capa es
 * la del condado, por codigo de municipio del PCN y usos del buy box (parcelas-palm-beach.ts).
 */
export class PalmBeachParcelsConnector implements IntegrationConnector {
  source = "palm-beach-parcels";
  displayName = "Palm Beach Parcels (ArcGIS)";
  category = "GIS / Parcels";
  accessMethod = IntegrationAccessMethod.API_REST;
  authType = "Public endpoint";
  cadence = "Near real-time";
  requiredEnv = [];

  /** Pagina siguiente de las parcelas del buy box en los corredores de Palm Beach. */
  async sync(contexto?: ContextoSync): Promise<SyncResult> {
    let corredores: CorredoresPalmBeach;
    try {
      corredores = corredoresPalmBeach();
    } catch (error) {
      return { status: IntegrationStatus.ERROR, message: `Palm Beach parcels: no corridors (${describeError(error)})` };
    }
    const where = wherePalmBeach(corredores);
    const clave = claveConsulta(CAPA_PALM_BEACH, where);
    const cantidad = parcelasPorCorrida();
    let { offset, vueltas } = posicionDe(contexto?.cursor, clave);
    try {
      let leidos = await fetchArcgisPagina(CAPA_PALM_BEACH, where, { offset, cantidad, orden: ORDEN });
      if (!leidos.length && offset > 0) {
        // El recorrido termino justo en el borde de una pagina: se vuelve al principio en la misma corrida.
        offset = 0;
        vueltas += 1;
        leidos = await fetchArcgisPagina(CAPA_PALM_BEACH, where, { offset, cantidad, orden: ORDEN });
      }
      // El cursor avanza por lo leido; a la ingesta va una fila por parcela y solo lo que esta dentro del corredor.
      const unicas = sinRepetidas(leidos);
      const records = unicas.filter((r) => dentroDelCorredor(r, corredores)).map(normalizarRegistroPalmBeach);
      return {
        status: IntegrationStatus.OK,
        message: `Palm Beach parcels: corridor page of ${records.length} (read ${leidos.length}) from ${offset}`,
        records,
        cursor: siguienteCursor(clave, offset, vueltas, leidos.length, cantidad),
        metrics: {
          modo: "corredores",
          municipiosPcn: corredores.prefijos.length,
          offset,
          pedidos: cantidad,
          leidos: leidos.length,
          repetidas: leidos.length - unicas.length,
          fueraDelCorredor: unicas.length - records.length,
          vuelta: vueltas,
          ...(corredores.sinSoporte.length ? { corredoresSinSoporte: corredores.sinSoporte } : {}),
        },
      };
    } catch (error) {
      return { status: IntegrationStatus.ERROR, message: `Palm Beach parcels fetch failed: ${describeError(error)}` };
    }
  }

  /** Liviano: una sola parcela y sin cursor. El estado de la integracion no mueve el recorrido. */
  async getHealthStatus(): Promise<HealthStatus> {
    try {
      await fetchArcgisPagina(CAPA_PALM_BEACH, "PARCEL_NUMBER IS NOT NULL", {
        offset: 0,
        cantidad: 1,
        orden: "PARCEL_NUMBER",
        geometria: false,
      });
      return { status: IntegrationStatus.OK, message: "Palm Beach parcels reachable" };
    } catch (error) {
      return { status: IntegrationStatus.ERROR, message: `Palm Beach parcels fetch failed: ${describeError(error)}` };
    }
  }
}
