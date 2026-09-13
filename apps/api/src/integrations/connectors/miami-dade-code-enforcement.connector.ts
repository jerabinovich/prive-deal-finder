import { fetchArcgisSample } from "./arcgis";
import {
  HealthStatus,
  IntegrationAccessMethod,
  IntegrationConnector,
  IntegrationStatus,
  SyncResult,
} from "./types";

/**
 * CODE ENFORCEMENT DE MIAMI-DADE — señal de distress gratuita
 *
 * POR QUE EXISTE. Las dos fuentes de foreclosure son de pago y estan trabadas
 * (Broward: unidades compradas que su API todavia no ve; Miami-Dade: registro
 * con saldo prepago, y encima es lookup por folio, sirve para enriquecer y no
 * para descubrir). Sin ninguna de las dos, el Deal Finder era una lista de
 * parcelas filtrada: 122 deals y CERO señales de distress.
 *
 * Miami-Dade publica sus violaciones de codigo en ArcGIS abierto, sin clave y
 * sin costo, CON FOLIO Y DIRECCION — o sea que cruza directo contra las
 * parcelas que ya tenemos. Medido el 13-sep-2026:
 *
 *   Lien_View                 7.138   lien registrado (deuda ejecutable)
 *   ReferredtoFinance_View   15.239   derivado a cobranza
 *   Open_View                 9.062   violacion abierta
 *
 * El lien mas reciente era del 2-jul-2026, asi que la fuente esta viva.
 *
 * POR QUE VALE TANTO COMO EL FORECLOSURE: un lien de code compliance es deuda
 * ejecutable sobre el inmueble y aparece ANTES que la ejecucion hipotecaria.
 * Es exactamente la ventaja que el Deal Finder busca — llegar al dueño en
 * problemas antes de que la propiedad salga al mercado. `CODE_ENFORCEMENT` ya
 * era una de las etapas de distress que el sistema modela.
 */
const BASE = "https://services.arcgis.com/8Pc9XBTAsYuxx9Ny/arcgis/rest/services";

/** De mas fuerte a mas debil. El orden importa: se ingiere en este orden. */
const LAYERS = [
  { key: "lien", service: "CodeComplianceViolation_Lien_View", status: "LIEN_RECORDED" },
  { key: "referred", service: "CodeComplianceViolation_ReferredtoFinance_View", status: "REFERRED_TO_FINANCE" },
  { key: "open", service: "CodeComplianceViolation_Open_View", status: "OPEN_VIOLATION" },
] as const;

export class MiamiDadeCodeEnforcementConnector implements IntegrationConnector {
  source = "miami-dade-code-enforcement";
  displayName = "Miami-Dade Code Enforcement (liens y violaciones)";
  category = "Distress / Code Enforcement";
  accessMethod = IntegrationAccessMethod.API_REST;
  authType = "Public endpoint";
  cadence = "Daily";
  /** Ninguna: es abierto. Se deja configurable por si mudan el servicio. */
  requiredEnv = [];

  private baseUrl() {
    return process.env.MIAMI_DADE_CODE_ENFORCEMENT_URL?.trim() || BASE;
  }

  private maxRows() {
    const parsed = Number(process.env.MIAMI_DADE_CODE_ENFORCEMENT_MAX_ROWS || 200);
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 2000) : 200;
  }

  /** Solo las capas elegidas, por si se quiere correr una sola. */
  private enabledLayers() {
    const raw = (process.env.MIAMI_DADE_CODE_ENFORCEMENT_LAYERS || "")
      .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    return raw.length ? LAYERS.filter((l) => raw.includes(l.key)) : LAYERS;
  }

  async sync(): Promise<SyncResult> {
    const limit = this.maxRows();
    const layers = this.enabledLayers();
    const records: Record<string, unknown>[] = [];
    const perLayer: Record<string, number> = {};
    const failures: string[] = [];

    for (const layer of layers) {
      const url = `${this.baseUrl()}/${layer.service}/FeatureServer/0`;
      try {
        // Solo lo que se puede cruzar: sin folio el registro no sirve para nada.
        const features = await fetchArcgisSample(
          url, limit, "FOLIO IS NOT NULL AND ADDRESS IS NOT NULL", "CASE_DATE DESC",
        );
        perLayer[layer.key] = features.length;
        for (const feature of features) {
          const attributes = (feature as { attributes?: Record<string, unknown> })?.attributes ?? {};
          records.push({
            ...attributes,
            // El pipeline generico de señales lee estas tres claves.
            status: layer.status,
            observedAt: attributes.CASE_DATE ?? attributes.LN_RECDATE ?? null,
            // Un lien es un hecho registrado, no una inferencia.
            confidence: layer.key === "lien" ? "high" : layer.key === "referred" ? "medium" : "low",
          });
        }
      } catch (error) {
        perLayer[layer.key] = 0;
        failures.push(`${layer.key}: ${error instanceof Error ? error.message : "error"}`);
      }
    }

    if (!records.length) {
      return {
        status: failures.length ? IntegrationStatus.ERROR : IntegrationStatus.OK,
        message: failures.length
          ? `Code enforcement fetch failed: ${failures.join(" | ")}`
          : "Code enforcement reachable (sin registros en las capas consultadas)",
        metrics: { perLayer, failures },
      };
    }

    return {
      status: IntegrationStatus.OK,
      message: `Miami-Dade code enforcement: ${records.length} registros`,
      records,
      metrics: { perLayer, failures, layersQueried: layers.map((l) => l.key), maxRowsPerLayer: limit },
    };
  }

  async getHealthStatus(): Promise<HealthStatus> {
    try {
      const url = `${this.baseUrl()}/${LAYERS[0].service}/FeatureServer/0`;
      const features = await fetchArcgisSample(url, 1, "FOLIO IS NOT NULL", "CASE_DATE DESC");
      return {
        status: IntegrationStatus.OK,
        message: features.length ? "Code enforcement reachable" : "Reachable, sin registros",
      };
    } catch (error) {
      return {
        status: IntegrationStatus.ERROR,
        message: `Code enforcement unreachable: ${error instanceof Error ? error.message : "error"}`,
      };
    }
  }
}
