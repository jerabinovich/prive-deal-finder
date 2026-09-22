import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { IntegrationsService } from "./integrations.service";
import { IntegrationStatus } from "./connectors/types";

const FIXTURE = path.join(__dirname, "fixtures", "miami-dade-clerk-resultado.sample.json");

// Todo lo que alimenta triage, lane o score. El sync del Clerk no puede tocar nada de esto.
const FORBIDDEN = ["deal.create", "deal.update", "deal.upsert", "deal.updateMany", "dealDistressSignal.upsert",
  "dealDistressSignal.create", "dealEvent.create", "dealMetric.create", "dealMetric.upsert", "dealMetric.update",
  "dealDecisionAudit.create", "stagingRecord.createMany"];

function prismaMock() {
  const staging: any[] = [];
  const mock: any = {
    integrationRun: {
      create: jest.fn(async () => ({ id: "run-1" })),
      update: jest.fn(async () => ({ startedAt: new Date() })),
    },
    integration: { upsert: jest.fn(async () => ({})) },
    alertEvent: { upsert: jest.fn(async () => ({ id: "alert-1" })) },
    alertRule: { findMany: jest.fn(async () => []) },
    alertInboxItem: { createMany: jest.fn(async () => ({})) },
    stagingRecord: {
      findFirst: jest.fn(async ({ where }: any) =>
        [...staging].reverse().find((r) => r.source === where.source && r.sourceRecordId === where.sourceRecordId) ?? null),
      create: jest.fn(async ({ data }: any) => {
        staging.push({ ...data, receivedAt: new Date() });
        return data;
      }),
      createMany: jest.fn(),
    },
    deal: {
      findMany: jest.fn(async () => [{ parcelId: "3031210000490" }]),
      create: jest.fn(), update: jest.fn(), upsert: jest.fn(), updateMany: jest.fn(),
    },
    dealDistressSignal: { upsert: jest.fn(), create: jest.fn() },
    dealEvent: { create: jest.fn() },
    dealMetric: { create: jest.fn(), upsert: jest.fn(), update: jest.fn() },
    dealDecisionAudit: { create: jest.fn() },
  };
  const forbiddenCalls = () =>
    FORBIDDEN.filter((name) => {
      const [model, method] = name.split(".");
      return mock[model][method].mock.calls.length > 0;
    });
  return { mock, staging, forbiddenCalls };
}

describe("IntegrationsService: miami-dade-clerk (solo informativo)", () => {
  const saved = process.env.MIAMI_DADE_CLERK_RESULT_PATH;
  const originalFetch = global.fetch;
  const fetchSpy = jest.fn(async () => {
    throw new Error("el sync del Clerk no debe salir a la red");
  });

  beforeEach(() => {
    (global as any).fetch = fetchSpy;
    fetchSpy.mockClear();
  });
  afterAll(() => {
    (global as any).fetch = originalFetch;
    if (saved === undefined) delete process.env.MIAMI_DADE_CLERK_RESULT_PATH;
    else process.env.MIAMI_DADE_CLERK_RESULT_PATH = saved;
  });

  it("esta registrado una sola vez y no pide confirmacion de gasto", () => {
    const { mock } = prismaMock();
    const service = new IntegrationsService(mock, {} as any);
    const sources = (service as any).connectors.map((c: { source: string }) => c.source);
    expect(sources.filter((s: string) => s === "miami-dade-clerk")).toHaveLength(1);
    expect((service as any).sourceRequiresPaidDataConfirmation("miami-dade-clerk")).toBe(false);
  });

  it("importa el resultado.json a StagingRecord y no toca deals, señales, eventos ni metricas", async () => {
    process.env.MIAMI_DADE_CLERK_RESULT_PATH = FIXTURE;
    const { mock, staging, forbiddenCalls } = prismaMock();
    const service = new IntegrationsService(mock, {} as any);

    const result = await service.sync("miami-dade-clerk");

    expect(result.status).toBe(IntegrationStatus.OK);
    expect(result.metrics).toEqual(
      expect.objectContaining({ folios: 6, storedRecords: 6, unchangedRecords: 0, matchedDeals: 1, skippedFolios: 3, clerkUnitsSpent: 0 }),
    );
    expect(staging).toHaveLength(6);
    expect(forbiddenCalls()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mock.alertEvent.upsert).not.toHaveBeenCalled();
    expect(mock.integration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { source: "miami-dade-clerk" }, update: expect.objectContaining({ status: "OK" }) }),
    );

    const again = await service.sync("miami-dade-clerk");
    expect(again.metrics).toEqual(expect.objectContaining({ storedRecords: 0, unchangedRecords: 6 }));
    expect(staging).toHaveLength(6);
  });

  it("sin archivo queda en NEEDS_CONFIG y no escribe nada", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-"));
    process.env.MIAMI_DADE_CLERK_RESULT_PATH = path.join(tmp, "no-existe.json");
    const { mock, staging, forbiddenCalls } = prismaMock();
    const service = new IntegrationsService(mock, {} as any);
    const conn = (service as any).connectors.find((c: { source: string }) => c.source === "miami-dade-clerk");
    // Las rutas por defecto podrian existir en la maquina que corre el test: se aislan.
    jest.spyOn(conn, "loadResult").mockReturnValueOnce({
      status: IntegrationStatus.NEEDS_CONFIG, message: "resultado.json de consultar.py no encontrado", filePath: null, parsed: null,
    });

    const result = await service.sync("miami-dade-clerk");
    expect(result.status).toBe(IntegrationStatus.NEEDS_CONFIG);
    expect(staging).toHaveLength(0);
    expect(forbiddenCalls()).toEqual([]);
  });

  it("una corrida abortada no se importa y queda en ERROR", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-"));
    const file = path.join(tmp, "resultado.json");
    const data = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...data, estado: "ABORTADA en la consulta 2" }));
    process.env.MIAMI_DADE_CLERK_RESULT_PATH = file;
    const { mock, staging, forbiddenCalls } = prismaMock();
    const service = new IntegrationsService(mock, {} as any);

    const result = await service.sync("miami-dade-clerk");
    expect(result.status).toBe(IntegrationStatus.ERROR);
    expect(result.message).toContain("no es una corrida COMPLETA");
    expect(staging).toHaveLength(0);
    expect(forbiddenCalls()).toEqual([]);
  });
});
