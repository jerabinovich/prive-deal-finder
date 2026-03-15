import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../shared/prisma.service";
import { ingestArcgisRecords } from "./arcgis.ingest";
import { MdpaDatasetType, MdpaIngestService } from "./mdpa.ingest";
import { resolveMdpaBulkFilePath } from "./mdpa.path";
import { BrowardForeclosureConnector } from "./connectors/broward-foreclosure.connector";
import { BrowardParcelsConnector } from "./connectors/broward-parcels.connector";
import { IntegrationConnector, IntegrationStatus } from "./connectors/types";
import { MdpaConnector } from "./connectors/mdpa.connector";
import { MiamiDadeForeclosureConnector } from "./connectors/miami-dade-foreclosure.connector";
import { MiamiDadeParcelsConnector } from "./connectors/miami-dade-parcels.connector";
import { PalmBeachParcelsConnector } from "./connectors/palm-beach-parcels.connector";
import { IntegrationRunsQueryDto } from "./dto/integration-runs-query.dto";
import { IntegrationStatusQueryDto } from "./dto/integration-status-query.dto";
import { MdpaImportDto } from "./dto/mdpa-import.dto";

export interface SyncResponse {
  status: IntegrationStatus;
  message: string;
  runId: string;
  metrics?: Record<string, unknown>;
}

type RunType = "CONNECTIVITY_CHECK" | "SAMPLE_SYNC" | "FULL_SYNC" | "BULK_INGEST" | "UNKNOWN";
type RunSeverity = "LOW" | "MEDIUM" | "HIGH";
type RunAnomalyType = "OWNER_LINK_GAP" | "NO_NEW_DEALS" | "LOW_VOLUME" | "AUTH_RISK" | "DATA_SCHEMA_CHANGE" | "OTHER";

type RunInsight = {
  runType: RunType;
  severity: RunSeverity;
  tableMessage: string;
  businessImpact: {
    createdDeals: number;
    updatedDeals: number;
    createdOwners: number;
    linkedOwners: number;
    sampledRecords: number;
  };
  anomalies: Array<{
    type: RunAnomalyType;
    detail: string;
    recommendedFix: string;
  }>;
  nextActions: Array<{
    priority: number;
    action: string;
    who: "SYSTEM" | "OPS" | "USER";
    why: string;
  }>;
  shouldAlert: boolean;
  alertReason: string;
};

@Injectable()
export class IntegrationsService {
  private readonly connectors: IntegrationConnector[] = [
    new MdpaConnector(),
    new MiamiDadeForeclosureConnector(),
    new BrowardForeclosureConnector(),
    new MiamiDadeParcelsConnector(),
    new BrowardParcelsConnector(),
    new PalmBeachParcelsConnector(),
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly mdpaIngest: MdpaIngestService
  ) {}

  private envStatus(keys: string[]) {
    return keys.map((key) => ({
      key,
      configured: Boolean(process.env[key]?.trim()),
    }));
  }

  private errorMessage(error: unknown, fallback: string) {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
  }

  private sourceRecordId(payload: unknown): string | undefined {
    const direct = payload as Record<string, unknown>;
    const attrs =
      direct && typeof direct === "object" && direct.attributes && typeof direct.attributes === "object"
        ? (direct.attributes as Record<string, unknown>)
        : direct;

    if (!attrs || typeof attrs !== "object") return undefined;

    const keys = ["OBJECTID", "objectid", "PARCEL_ID", "PARID", "FOLIO", "PARCELNO", "PARCEL_NO"];
    for (const key of keys) {
      const value = attrs[key];
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }

    return undefined;
  }

  private parseBoolean(value: string | undefined, fallback: boolean) {
    if (!value) return fallback;
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    return fallback;
  }

  private parsePositiveInt(value: string | undefined, fallback: number, min = 1, max = 500) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  }

  private mdpaConfirmationRequired() {
    return this.parseBoolean(process.env.MDPA_REQUIRE_CONFIRMATION, true);
  }

  private mdpaEstimatedCredits() {
    const parsed = Number(process.env.MDPA_ESTIMATED_CREDITS || 50);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
  }

  private browardForeclosureConfirmationRequired() {
    return this.parseBoolean(process.env.BROWARD_FORECLOSURE_REQUIRE_CONFIRMATION, true);
  }

  private browardForeclosureEstimatedCredits() {
    const parsed = Number(process.env.BROWARD_FORECLOSURE_ESTIMATED_CREDITS || 250);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 250;
  }

  private sourceRequiresPaidDataConfirmation(source: string) {
    if (source === "mdpa") return this.mdpaConfirmationRequired();
    if (source === "broward-foreclosure") return this.browardForeclosureConfirmationRequired();
    return false;
  }

  private sourceEstimatedCredits(source: string) {
    if (source === "mdpa") return this.mdpaEstimatedCredits();
    if (source === "broward-foreclosure") return this.browardForeclosureEstimatedCredits();
    return null;
  }

  private sourceConfirmationMessage(source: string, estimatedCredits: number | null) {
    const credits = estimatedCredits ?? 0;
    if (source === "mdpa") {
      return `MDPA usa datasets de pago (${credits} creditos estimados). Confirma antes de ejecutar sync.`;
    }
    if (source === "broward-foreclosure") {
      return `Broward Clerk API consume creditos (${credits} estimados). Confirma antes de ejecutar sync.`;
    }
    return null;
  }

  private normalizeDatasetType(input?: string): MdpaDatasetType {
    const value = String(input || "").trim().toUpperCase();
    if (value === "MUNICIPAL_ROLLS") return "MUNICIPAL_ROLLS";
    if (value === "SALES_INFO") return "SALES_INFO";
    if (value === "ROLL_EVENTS") return "ROLL_EVENTS";
    if (value === "PROPERTY_INFO") return "PROPERTY_INFO";
    if (value === "SPECIAL_REQUEST") return "SPECIAL_REQUEST";
    return "GENERIC";
  }

  private parseMetrics(metrics: string | null) {
    if (!metrics) return null;
    try {
      return JSON.parse(metrics) as Record<string, unknown>;
    } catch (_error) {
      return { raw: metrics };
    }
  }

  private metricNumber(metrics: Record<string, unknown> | null, key: string) {
    if (!metrics) return 0;
    const value = metrics[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  private classifyRunType(params: {
    source: string;
    message: string | null;
    metrics: Record<string, unknown> | null;
    durationSeconds: number | null;
  }): RunType {
    const source = params.source.toLowerCase();
    const message = String(params.message || "").toLowerCase();
    const metrics = params.metrics ?? {};
    const durationSeconds = params.durationSeconds;
    const sampledRecords = this.metricNumber(metrics, "sampledRecords");
    const processed = this.metricNumber(metrics, "processed");
    const createdDeals = this.metricNumber(metrics, "createdDeals");
    const updatedDeals = this.metricNumber(metrics, "updatedDeals");
    const requestsMade = this.metricNumber(metrics, "requestsMade");
    const successfulLookups = this.metricNumber(metrics, "successfulLookups");
    const hasSnapshotId = typeof metrics.snapshotId === "string" && metrics.snapshotId.trim().length > 0;
    const hasDatasetType = typeof metrics.datasetType === "string" && metrics.datasetType.trim().length > 0;

    if (source === "mdpa" && (hasSnapshotId || hasDatasetType)) return "BULK_INGEST";
    if (durationSeconds !== null && durationSeconds <= 10 && sampledRecords > 0 && sampledRecords <= 200) {
      return createdDeals > 0 || updatedDeals > 0 ? "SAMPLE_SYNC" : "CONNECTIVITY_CHECK";
    }
    if (message.includes("reachable") && sampledRecords === 0 && processed === 0 && createdDeals === 0 && updatedDeals === 0) {
      return "CONNECTIVITY_CHECK";
    }
    if (processed >= 500 || createdDeals >= 100 || updatedDeals >= 100 || (durationSeconds !== null && durationSeconds >= 180)) {
      return "FULL_SYNC";
    }
    if (source.includes("foreclosure") && (requestsMade > 0 || successfulLookups > 0)) {
      return "FULL_SYNC";
    }
    return "UNKNOWN";
  }

  private deriveRunInsight(params: {
    source: string;
    status: string;
    message: string | null;
    metrics: Record<string, unknown> | null;
    startedAt: Date;
    endedAt: Date | null;
    runType: RunType;
  }): RunInsight {
    const status = params.status.toUpperCase();
    const metrics = params.metrics ?? {};
    const message = String(params.message || "");
    const durationSeconds =
      params.endedAt && params.startedAt
        ? Math.max(0, Math.round((params.endedAt.getTime() - params.startedAt.getTime()) / 1000))
        : null;

    const createdDeals = this.metricNumber(metrics, "createdDeals");
    const updatedDeals = this.metricNumber(metrics, "updatedDeals");
    const createdOwners = this.metricNumber(metrics, "createdOwners");
    const linkedOwners = this.metricNumber(metrics, "linkedOwners");
    const sampledRecords = this.metricNumber(metrics, "sampledRecords");
    const processed = this.metricNumber(metrics, "processed");

    const anomalies: RunInsight["anomalies"] = [];
    if (updatedDeals > 0 && linkedOwners < updatedDeals) {
      anomalies.push({
        type: "OWNER_LINK_GAP",
        detail: `Owner linkage gap: ${linkedOwners}/${updatedDeals}.`,
        recommendedFix: "Revisar matching owner↔parcel (APN/dirección) y normalización de llaves.",
      });
    }
    if ((params.runType === "FULL_SYNC" || params.runType === "BULK_INGEST") && createdDeals === 0 && updatedDeals > 0) {
      anomalies.push({
        type: "NO_NEW_DEALS",
        detail: "No se crearon deals nuevos durante sync completo.",
        recommendedFix: "Validar cobertura/ventana temporal y reglas de deduplicación.",
      });
    }
    if ((params.runType === "FULL_SYNC" || params.runType === "BULK_INGEST") && processed > 0 && processed < 5) {
      anomalies.push({
        type: "LOW_VOLUME",
        detail: `Volumen procesado bajo (${processed}) para sync no-muestra.`,
        recommendedFix: "Verificar filtros de ingestión y disponibilidad de dataset.",
      });
    }

    const lowered = `${message} ${JSON.stringify(metrics)}`.toLowerCase();
    if (lowered.includes("unauthorized") || lowered.includes("forbidden") || lowered.includes("auth") || lowered.includes("confirm required")) {
      anomalies.push({
        type: "AUTH_RISK",
        detail: "Riesgo de autorización/configuración detectado.",
        recommendedFix: "Validar credenciales y confirmar permisos antes de próximo sync.",
      });
    }

    let severity: RunSeverity = "LOW";
    if (status !== IntegrationStatus.OK) {
      severity = "HIGH";
    } else if (anomalies.length > 0) {
      severity = "MEDIUM";
    }

    const tableBits: string[] = [];
    if (params.runType === "SAMPLE_SYNC") {
      tableBits.push(`sync de muestra ${sampledRecords || 0}`);
    } else if (params.runType === "CONNECTIVITY_CHECK") {
      tableBits.push("check de conectividad");
    } else if (params.runType === "BULK_INGEST") {
      tableBits.push("ingesta bulk");
    } else if (params.runType === "FULL_SYNC") {
      tableBits.push("sync completo");
    } else {
      tableBits.push("sync");
    }
    tableBits.push(`${createdDeals} nuevos`, `${updatedDeals} actualizados`);
    if (updatedDeals > 0) tableBits.push(`owners ${linkedOwners}/${updatedDeals}`);
    if (durationSeconds !== null) tableBits.push(`${durationSeconds}s`);

    const nextActions: RunInsight["nextActions"] = [];
    if (anomalies.some((item) => item.type === "OWNER_LINK_GAP")) {
      nextActions.push({
        priority: 1,
        action: "Auditar registros sin owner link y corregir normalización APN/dirección.",
        who: "SYSTEM",
        why: "Mejora contactabilidad y evita falsos positivos de oportunidad.",
      });
    }
    if (anomalies.some((item) => item.type === "AUTH_RISK")) {
      nextActions.push({
        priority: 1,
        action: "Validar credenciales/permisos y reintentar sync.",
        who: "OPS",
        why: "Sin autorización válida no hay ingestión confiable.",
      });
    }
    if (params.runType === "SAMPLE_SYNC") {
      nextActions.push({
        priority: 2,
        action: "Programar FULL_SYNC si se espera nuevo inventario.",
        who: "OPS",
        why: "Muestras validan conexión, pero no maximizan cobertura.",
      });
    }
    if (!nextActions.length) {
      nextActions.push({
        priority: 1,
        action: "Mantener monitoreo y revisar próximos runs.",
        who: "SYSTEM",
        why: "No se detectaron anomalías críticas.",
      });
    }

    const shouldAlert =
      severity === "HIGH" ||
      anomalies.some((item) => item.type === "AUTH_RISK") ||
      anomalies.some((item) => item.type === "DATA_SCHEMA_CHANGE");
    const alertReason = shouldAlert
      ? severity === "HIGH"
        ? "Run failed or degraded."
        : "Operational anomaly requires follow-up."
      : "";

    return {
      runType: params.runType,
      severity,
      tableMessage: `${params.source}: ${tableBits.join(" · ")}`.slice(0, 120),
      businessImpact: {
        createdDeals,
        updatedDeals,
        createdOwners,
        linkedOwners,
        sampledRecords,
      },
      anomalies,
      nextActions: nextActions.slice(0, 3),
      shouldAlert,
      alertReason,
    };
  }

  private extractDistressField(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = record[key];
      if (value === undefined || value === null) continue;
      const text = String(value).trim();
      if (text) return text;
    }
    return null;
  }

  private normalizeParcelId(value: string | null) {
    if (!value) return null;
    const digits = value.replace(/[^\d]/g, "");
    if (!digits) return null;
    return digits.length > 10 ? digits : value.trim();
  }

  private normalizeDistressStatus(value: string | null) {
    const raw = String(value || "CONFIRMED").trim().toUpperCase();
    if (!raw) return "CONFIRMED";
    if (raw.includes("CLEAR") || raw.includes("RELEASE")) return "CLEARED";
    if (raw.includes("CANDIDATE") || raw.includes("PENDING")) return "CANDIDATE";
    return "CONFIRMED";
  }

  private normalizeDistressConfidence(value: string | null) {
    const raw = String(value || "MEDIUM").trim().toUpperCase();
    if (raw.startsWith("H")) return "HIGH";
    if (raw.startsWith("L")) return "LOW";
    return "MEDIUM";
  }

  private parseObservedAt(value: string | null) {
    if (!value) return new Date();
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : new Date();
  }

  private async ingestDistressRecords(source: string, records: unknown[]) {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let unmatched = 0;

    for (const item of records) {
      const raw = item as Record<string, unknown>;
      const record =
        raw && typeof raw === "object" && raw.attributes && typeof raw.attributes === "object"
          ? (raw.attributes as Record<string, unknown>)
          : raw;
      if (!record || typeof record !== "object") {
        skipped += 1;
        continue;
      }

      const rawParcelId = this.extractDistressField(record, [
        "parcelId",
        "parcel_id",
        "PARCEL_ID",
        "folio",
        "FOLIO",
        "parcel",
        "PARID",
      ]);
      const parcelId = this.normalizeParcelId(rawParcelId);
      const address = this.extractDistressField(record, [
        "address",
        "ADDRESS",
        "situs",
        "SITUS_ADDRESS",
        "property_address",
      ]);
      const status = this.normalizeDistressStatus(this.extractDistressField(record, ["status", "STATUS", "event_type"]));
      const confidence = this.normalizeDistressConfidence(
        this.extractDistressField(record, ["confidence", "CONFIDENCE", "quality"]),
      );
      const observedAt = this.parseObservedAt(
        this.extractDistressField(record, ["observedAt", "observed_at", "saleDate", "eventDate", "date"]),
      );

      const deal = parcelId
        ? await this.prisma.deal.findFirst({ where: { parcelId } })
        : address
          ? await this.prisma.deal.findFirst({ where: { address: { contains: address } } })
          : null;
      if (!deal) {
        unmatched += 1;
        continue;
      }

      const where = {
        dealId_source_observedAt: {
          dealId: deal.id,
          source,
          observedAt,
        },
      };
      const existing = await this.prisma.dealDistressSignal.findUnique({ where });
      await this.prisma.dealDistressSignal.upsert({
        where,
        update: {
          status,
          confidence,
          metadata: JSON.stringify(record),
        },
        create: {
          dealId: deal.id,
          status,
          source,
          observedAt,
          confidence,
          metadata: JSON.stringify(record),
        },
      });
      if (existing) updated += 1;
      else created += 1;
    }

    return {
      sampledRecords: records.length,
      createdSignals: created,
      updatedSignals: updated,
      skippedRecords: skipped,
      unmatchedRecords: unmatched,
    };
  }

  private async startRun(source: string) {
    return this.prisma.integrationRun.create({
      data: {
        source,
        status: "RUNNING",
        startedAt: new Date(),
      },
    });
  }

  private async finishRun(
    runId: string,
    source: string,
    result: { status: IntegrationStatus; message: string; metrics?: Record<string, unknown> }
  ): Promise<SyncResponse> {
    const finishedAt = new Date();
    const updatedRun = await this.prisma.integrationRun.update({
      where: { id: runId },
      data: {
        status: result.status,
        message: result.message,
        metrics: result.metrics ? JSON.stringify(result.metrics) : null,
        endedAt: finishedAt,
      },
      select: {
        startedAt: true,
      },
    });

    const durationSeconds = Math.max(0, Math.round((finishedAt.getTime() - updatedRun.startedAt.getTime()) / 1000));
    const runType = this.classifyRunType({
      source,
      message: result.message,
      metrics: result.metrics ?? null,
      durationSeconds,
    });
    const runInsight = this.deriveRunInsight({
      source,
      status: result.status,
      message: result.message,
      metrics: result.metrics ?? null,
      startedAt: updatedRun.startedAt,
      endedAt: finishedAt,
      runType,
    });

    if (runInsight.shouldAlert) {
      const triggerType = "INTEGRATION_RUN_ALERT";
      const severity = runInsight.severity as "LOW" | "MEDIUM" | "HIGH";
      const dedupeKey = `integration:${source}:${runId}:${severity}`;
      const payload = {
        source,
        runId,
        runType,
        severity,
        tableMessage: runInsight.tableMessage,
        anomalies: runInsight.anomalies,
        nextActions: runInsight.nextActions,
      };
      const alertEvent = await this.prisma.alertEvent.upsert({
        where: { dedupeKey },
        update: {
          severity: severity as any,
          eventAt: finishedAt,
          payloadJson: JSON.stringify(payload),
        },
        create: {
          triggerType,
          severity: severity as any,
          eventAt: finishedAt,
          payloadJson: JSON.stringify(payload),
          dedupeKey,
        },
      });

      const alertRules = await this.prisma.alertRule.findMany({
        where: {
          active: true,
          triggerType,
          delivery: "IN_APP",
        },
        select: { userId: true },
      });
      if (alertRules.length) {
        await this.prisma.alertInboxItem.createMany({
          data: alertRules.map((rule) => ({
            userId: rule.userId,
            alertEventId: alertEvent.id,
            deliveredAt: finishedAt,
            channel: "IN_APP",
          })),
          skipDuplicates: true,
        });
      }
    }

    await this.prisma.integration.upsert({
      where: { source },
      update: {
        status: result.status,
        ...(result.status === IntegrationStatus.OK ? { lastSyncAt: finishedAt } : {}),
        lastError: result.status === IntegrationStatus.OK ? null : result.message,
      },
      create: {
        source,
        status: result.status,
        lastSyncAt: result.status === IntegrationStatus.OK ? finishedAt : null,
        lastError: result.status === IntegrationStatus.OK ? null : result.message,
      },
    });

    return {
      status: result.status,
      message: result.message,
      runId,
      ...(result.metrics ? { metrics: result.metrics } : {}),
    };
  }

  async listStatus(query: IntegrationStatusQueryDto = {}) {
    const [totalDeals, distressDeals, nextEventDeals, contactableDeals] = await Promise.all([
      this.prisma.deal.count(),
      this.prisma.deal.count({
        where: {
          lane: { in: ["DISTRESS_OWNER", "AUCTION_MONITOR"] as any },
        },
      }),
      this.prisma.deal.count({
        where: { nextEventDate: { not: null } },
      }),
      this.prisma.deal.count({
        where: { contactabilityScore: { gte: 50 } },
      }),
    ]);
    const pct = (value: number) => (totalDeals > 0 ? Number(((value / totalDeals) * 100).toFixed(1)) : 0);
    const portfolioActionability = {
      totalDeals,
      distressEvidencePct: pct(distressDeals),
      nextEventPct: pct(nextEventDeals),
      contactablePct: pct(contactableDeals),
    };

    const rows = await Promise.all(
      this.connectors.map(async (connector) => {
        const status = await connector.getHealthStatus();
        const integration = await this.prisma.integration.upsert({
          where: { source: connector.source },
          update: {
            status: status.status,
            lastError: status.status === IntegrationStatus.OK ? null : status.message,
          },
          create: {
            source: connector.source,
            status: status.status,
            lastError: status.status === IntegrationStatus.OK ? null : status.message,
          },
        });

        const latestRun = await this.prisma.integrationRun.findFirst({
          where: { source: connector.source },
          orderBy: { startedAt: "desc" },
        });

        const requiresPaidDataConfirmation = this.sourceRequiresPaidDataConfirmation(connector.source);
        const estimatedCreditCost = this.sourceEstimatedCredits(connector.source);
        const confirmationMessage = requiresPaidDataConfirmation
          ? this.sourceConfirmationMessage(connector.source, estimatedCreditCost)
          : null;

        const requiredEnv = this.envStatus(connector.requiredEnv);
        const configured = requiredEnv.every((entry) => entry.configured);
        const configuredCount = requiredEnv.filter((entry) => entry.configured).length;
        const coverage = requiredEnv.length ? Number(((configuredCount / requiredEnv.length) * 100).toFixed(1)) : 100;
        const lastSuccessfulRun = latestRun?.status === IntegrationStatus.OK ? latestRun.startedAt : integration.lastSyncAt;
        const nowMs = Date.now();
        const freshness =
          !integration.lastSyncAt
            ? "unknown"
            : nowMs - integration.lastSyncAt.getTime() <= 24 * 60 * 60 * 1000
              ? "fresh"
              : "stale";
        const blockedReason = !configured
          ? "Missing environment configuration"
          : status.status === IntegrationStatus.ERROR
            ? status.message || "Connector error"
            : null;
        return {
          source: connector.source,
          displayName: connector.displayName,
          category: connector.category,
          accessMethod: connector.accessMethod,
          authType: connector.authType,
          cadence: connector.cadence,
          requiredEnv,
          configured,
          requiresPaidDataConfirmation,
          estimatedCreditCost,
          confirmationMessage,
          status: status.status,
          message: status.message ?? "",
          lastSyncAt: integration.lastSyncAt,
          lastError: integration.lastError,
          freshness,
          coverage,
          lastSuccessfulRun,
          blockedReason,
          operatorSummary: {
            freshness,
            coverage,
            lastSuccessfulRun,
            blockedReason,
          },
          actionability: portfolioActionability,
          lastRun: latestRun
            ? {
                id: latestRun.id,
                status: latestRun.status,
                startedAt: latestRun.startedAt,
                endedAt: latestRun.endedAt,
              }
            : null,
        };
      })
    );

    return rows.filter((row) => {
      if (query.source?.trim() && !row.source.toLowerCase().includes(query.source.trim().toLowerCase())) return false;
      if (query.category?.trim() && !row.category.toLowerCase().includes(query.category.trim().toLowerCase())) return false;
      if (typeof query.configured === "boolean" && row.configured !== query.configured) return false;
      if (query.status?.trim() && row.status.toLowerCase() !== query.status.trim().toLowerCase()) return false;
      if (query.freshness?.trim() && row.freshness.toLowerCase() !== query.freshness.trim().toLowerCase()) return false;
      if (typeof query.blocked === "boolean") {
        const blocked = Boolean(row.blockedReason);
        if (blocked !== query.blocked) return false;
      }
      return true;
    });
  }

  async listConnectedAndTested() {
    const rows = await this.prisma.integration.findMany({
      where: { status: IntegrationStatus.OK, lastSyncAt: { not: null } },
      orderBy: { lastSyncAt: "desc" },
    });
    const connectorBySource = new Map(this.connectors.map((connector) => [connector.source, connector]));
    return rows.map((row: any) => ({
      source: row.source,
      displayName: connectorBySource.get(row.source)?.displayName ?? row.source,
      status: row.status,
      lastSyncAt: row.lastSyncAt,
    }));
  }

  async listRuns(query: IntegrationRunsQueryDto = {}) {
    const safeLimit = Number.isFinite(query.limit) ? Math.min(Math.max(query.limit ?? 20, 1), 200) : 20;
    const safeOffset = Number.isFinite(query.offset) ? Math.max(query.offset ?? 0, 0) : 0;
    const sortDir: Prisma.SortOrder = query.sortDir === "asc" ? "asc" : "desc";
    const sortBy = query.sortBy ?? "startedAt";
    const orderBy: Prisma.IntegrationRunOrderByWithRelationInput =
      sortBy === "endedAt"
        ? { endedAt: sortDir }
        : sortBy === "status"
          ? { status: sortDir }
          : sortBy === "source"
            ? { source: sortDir }
            : { startedAt: sortDir };
    const startedAt: { gte?: Date; lte?: Date } = {};
    if (query.dateFrom) {
      const parsed = new Date(query.dateFrom);
      if (Number.isFinite(parsed.getTime())) startedAt.gte = parsed;
    }
    if (query.dateTo) {
      const parsed = new Date(query.dateTo);
      if (Number.isFinite(parsed.getTime())) startedAt.lte = parsed;
    }

    const rows = await this.prisma.integrationRun.findMany({
      where: {
        ...(query.source?.trim() ? { source: query.source.trim() } : {}),
        ...(query.status?.trim() ? { status: query.status.trim() } : {}),
        ...(query.message?.trim()
          ? {
              message: {
                contains: query.message.trim(),
                mode: "insensitive",
              },
            }
          : {}),
        ...(Object.keys(startedAt).length ? { startedAt } : {}),
      },
      orderBy,
      take: safeLimit,
      skip: safeOffset,
    });

    const operatorView = query.operatorView ?? true;

    return rows.map((row: any) => {
      const metrics = this.parseMetrics(row.metrics);
      if (!operatorView) {
        return {
          id: row.id,
          source: row.source,
          status: row.status,
          message: row.message,
          metrics,
          startedAt: row.startedAt,
          endedAt: row.endedAt,
        };
      }

      const durationSeconds =
        row.endedAt && row.startedAt
          ? Math.max(0, Math.round((new Date(row.endedAt).getTime() - new Date(row.startedAt).getTime()) / 1000))
          : null;
      const runType = this.classifyRunType({
        source: row.source,
        message: row.message,
        metrics,
        durationSeconds,
      });
      const insight = this.deriveRunInsight({
        source: row.source,
        status: row.status,
        message: row.message,
        metrics,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        runType,
      });

      return {
        id: row.id,
        source: row.source,
        status: row.status,
        message: row.message,
        metrics,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        ...insight,
      };
    });
  }

  async mdpaCatalog() {
    const recentSnapshots = await this.prisma.mdpaDatasetSnapshot.findMany({
      orderBy: { snapshotDate: "desc" },
      take: 100,
    });

    const byLibrary = new Map<string, (typeof recentSnapshots)[number]>();
    for (const item of recentSnapshots) {
      if (!byLibrary.has(item.library)) {
        byLibrary.set(item.library, item);
      }
    }

    const now = Date.now();
    const staleMs = 8 * 24 * 60 * 60 * 1000;
    const datasets = [
      { datasetType: "MUNICIPAL_ROLLS", library: "RE Municipal Rolls", paid: true },
      { datasetType: "SALES_INFO", library: "RE Sales Info", paid: true },
      { datasetType: "ROLL_EVENTS", library: "RE Roll Events", paid: true },
      { datasetType: "PROPERTY_INFO", library: "RE Property Info", paid: true },
      { datasetType: "SPECIAL_REQUEST", library: "RE Special Request", paid: true },
      { datasetType: "GENERIC", library: "MDPA Generic", paid: true },
      { datasetType: "MAIN", library: "Main Library", paid: false },
    ] as const;

    return datasets.map((item) => {
      const snapshot = byLibrary.get(item.library) ?? null;
      const ageMs = snapshot ? now - new Date(snapshot.snapshotDate).getTime() : null;
      const status = !snapshot ? "MISSING" : ageMs !== null && ageMs > staleMs ? "STALE" : "READY";
      return {
        datasetType: item.datasetType,
        library: item.library,
        status,
        paid: item.paid,
        requiresConfirmation: item.paid && this.mdpaConfirmationRequired(),
        estimatedCredits: item.paid ? this.mdpaEstimatedCredits() : 0,
        latestSnapshot: snapshot
          ? {
              id: snapshot.id,
              snapshotDate: snapshot.snapshotDate,
              fileName: snapshot.fileName,
              sha256: snapshot.sha256,
              recordCount: snapshot.recordCount,
              sourceUrl: snapshot.sourceUrl,
            }
          : null,
      };
    });
  }

  async importMdpaDataset(payload: MdpaImportDto): Promise<SyncResponse> {
    const datasetType = this.normalizeDatasetType(payload.datasetType);
    if (this.mdpaConfirmationRequired() && !payload.confirmPaidDataUse) {
      const credits = this.mdpaEstimatedCredits();
      throw new BadRequestException(
        `Confirmation required before importing MDPA paid dataset (${credits} credits estimated). Retry with confirmPaidDataUse=true.`
      );
    }

    const { resolvedPath, checkedPaths } = resolveMdpaBulkFilePath(payload.filePath || process.env.MDPA_BULK_FILE_PATH);
    if (!resolvedPath) {
      throw new BadRequestException(`MDPA file not found. Checked: ${checkedPaths.join(", ")}`);
    }

    const run = await this.startRun("mdpa");
    try {
      const ingest = await this.mdpaIngest.ingest(resolvedPath, {
        maxRows: Number(process.env.MDPA_MAX_ROWS || 1000),
        datasetType,
        sourceUrl: payload.sourceUrl,
      });

      return this.finishRun(run.id, "mdpa", {
        status: IntegrationStatus.OK,
        message: `MDPA ${datasetType} imported ${ingest.processed} rows`,
        metrics: ingest as unknown as Record<string, unknown>,
      });
    } catch (error) {
      return this.finishRun(run.id, "mdpa", {
        status: IntegrationStatus.ERROR,
        message: this.errorMessage(error, "MDPA import failed"),
      });
    }
  }

  async sync(source: string, options?: { confirmPaidDataUse?: boolean }): Promise<SyncResponse> {
    const connector = this.connectors.find((item) => item.source === source);
    if (!connector) {
      return {
        status: IntegrationStatus.ERROR,
        message: "Unknown source",
        runId: "N/A",
      };
    }

    if (this.sourceRequiresPaidDataConfirmation(source) && !options?.confirmPaidDataUse) {
      const credits = this.sourceEstimatedCredits(source) ?? 50;
      throw new BadRequestException(
        `Confirmation required before using ${source} paid data (${credits} credits estimated). Retry with confirmPaidDataUse=true.`
      );
    }

    const run = await this.startRun(source);

    try {
      if (source === "mdpa") {
        const { resolvedPath, checkedPaths } = resolveMdpaBulkFilePath(process.env.MDPA_BULK_FILE_PATH);
        if (!resolvedPath) {
          return this.finishRun(run.id, source, {
            status: IntegrationStatus.NEEDS_CONFIG,
            message: `MDPA bulk file not found. Checked: ${checkedPaths.join(", ")}`,
          });
        }

        const ingest = await this.mdpaIngest.ingest(resolvedPath, {
          maxRows: Number(process.env.MDPA_MAX_ROWS || 1000),
          datasetType: "MUNICIPAL_ROLLS",
          sourceUrl: process.env.MDPA_SOURCE_URL,
        });

        return this.finishRun(run.id, source, {
          status: IntegrationStatus.OK,
          message: `MDPA ingested ${ingest.processed} rows`,
          metrics: ingest as unknown as Record<string, unknown>,
        });
      }

      if (source === "miami-dade-foreclosure" && connector instanceof MiamiDadeForeclosureConnector) {
        const maxFolios = this.parsePositiveInt(process.env.MIAMI_DADE_FORECLOSURE_MAX_FOLIOS, 40, 1, 1000);
        const deals = await this.prisma.deal.findMany({
          where: {
            market: "Miami-Dade",
            parcelId: { not: null },
          },
          orderBy: { updatedAt: "desc" },
          take: maxFolios,
          select: {
            parcelId: true,
          },
        });

        const folios = Array.from(
          new Set(
            deals
              .map((item) => String(item.parcelId || "").replace(/[^\d]/g, ""))
              .filter((value) => value.length > 0)
          )
        );

        if (!folios.length) {
          return this.finishRun(run.id, source, {
            status: IntegrationStatus.ERROR,
            message: "No Miami-Dade parcel IDs available for foreclosure lookup",
          });
        }

        const distressRecords: Record<string, unknown>[] = [];
        let successfulLookups = 0;
        let failedLookups = 0;
        let lastUnitsBalance: unknown = null;
        const failureReasonCounts: Record<string, number> = {};
        const failedLookupDetails: Array<Record<string, unknown>> = [];

        const recordLookupFailure = (
          folio: string,
          lookup: {
            status: IntegrationStatus;
            message: string;
            metrics: Record<string, unknown>;
          },
        ) => {
          const statusDesc =
            typeof lookup.metrics.statusDesc === "string" ? lookup.metrics.statusDesc.trim() : "";
          const connectorStatus = typeof lookup.metrics.status === "string" ? lookup.metrics.status.trim() : "";
          const reason = statusDesc || connectorStatus || lookup.message || "Unknown failure";
          failureReasonCounts[reason] = (failureReasonCounts[reason] ?? 0) + 1;

          failedLookupDetails.push({
            folio,
            status: lookup.status,
            reason,
            connectorMessage: lookup.message,
            connectorStatus: connectorStatus || null,
            statusDesc: statusDesc || null,
            httpStatus: lookup.metrics.httpStatus ?? null,
            ipAddress: lookup.metrics.ipAddress ?? null,
            unitsBalance: lookup.metrics.unitsBalance ?? null,
          });
        };

        for (const folio of folios) {
          const lookup = await connector.lookupByFolio(folio);
          if (lookup.status === IntegrationStatus.NEEDS_CONFIG) {
            failedLookups += 1;
            recordLookupFailure(folio, lookup);
            return this.finishRun(run.id, source, {
              status: IntegrationStatus.NEEDS_CONFIG,
              message: lookup.message,
              metrics: {
                checkedFolios: successfulLookups + failedLookups + 1,
                sampledFolios: folios.length,
                folio,
                failedLookups,
                failureReasonCounts,
                failedLookupDetails,
                ...(lookup.metrics ?? {}),
              },
            });
          }

          if (lookup.status !== IntegrationStatus.OK) {
            failedLookups += 1;
            recordLookupFailure(folio, lookup);
            continue;
          }

          successfulLookups += 1;
          if (lookup.metrics && "unitsBalance" in lookup.metrics) {
            lastUnitsBalance = lookup.metrics.unitsBalance;
          }
          if (lookup.records?.length) {
            distressRecords.push(...lookup.records);
          }
        }

        if (!successfulLookups && failedLookups) {
          return this.finishRun(run.id, source, {
            status: IntegrationStatus.ERROR,
            message: "Foreclosure lookup failed for all sampled folios",
            metrics: {
              sampledFolios: folios.length,
              successfulLookups,
              failedLookups,
              failureReasonCounts,
              failedLookupDetails,
            },
          });
        }

        const ingestMetrics = distressRecords.length
          ? await this.ingestDistressRecords(source, distressRecords)
          : { createdSignals: 0, updatedSignals: 0, skippedRecords: 0, unmatchedRecords: 0, sampledRecords: 0 };

        return this.finishRun(run.id, source, {
          status: IntegrationStatus.OK,
          message:
            distressRecords.length > 0
              ? "Foreclosure lookup completed"
              : "Foreclosure lookup completed (no distress records matched sampled folios)",
          metrics: {
            sampledFolios: folios.length,
            successfulLookups,
            failedLookups,
            distressRecords: distressRecords.length,
            unitsBalance: lastUnitsBalance,
            ...(failedLookups
              ? {
                  failureReasonCounts,
                  failedLookupDetails,
                }
              : {}),
            ...ingestMetrics,
          },
        });
      }

      const result = await connector.sync();
      if (result.status !== IntegrationStatus.OK || !result.records?.length) {
        return this.finishRun(run.id, source, {
          status: result.status,
          message: result.message ?? "Sync completed",
          metrics: result.metrics,
        });
      }

      if (source === "miami-dade-foreclosure" || source === "broward-foreclosure") {
        const metrics = await this.ingestDistressRecords(source, result.records);
        return this.finishRun(run.id, source, {
          status: IntegrationStatus.OK,
          message: result.message ?? "Foreclosure sync completed",
          metrics: {
            ...metrics,
            ...(result.metrics ?? {}),
          },
        });
      }

      await this.prisma.stagingRecord.createMany({
        data: result.records.map((payload) => ({
          source,
          sourceRecordId: this.sourceRecordId(payload),
          payload: JSON.stringify(payload),
          status: "SAMPLED",
        })),
      });

      const marketMap: Record<string, string> = {
        "miami-dade-parcels": "Miami-Dade",
        "broward-parcels": "Broward",
        "palm-beach-parcels": "Palm Beach",
      };

      const market = marketMap[source];
      if (!market) {
        return this.finishRun(run.id, source, {
          status: IntegrationStatus.OK,
          message: result.message ?? "Sync completed",
          metrics: {
            sampledRecords: result.records.length,
          },
        });
      }

      const ingestMetrics = await ingestArcgisRecords(this.prisma, source, market, result.records);
      return this.finishRun(run.id, source, {
        status: IntegrationStatus.OK,
        message: result.message ?? "Sync completed",
        metrics: {
          sampledRecords: result.records.length,
          ...ingestMetrics,
        },
      });
    } catch (error) {
      const message = this.errorMessage(error, "Sync failed");
      return this.finishRun(run.id, source, {
        status: IntegrationStatus.ERROR,
        message,
      });
    }
  }
}
