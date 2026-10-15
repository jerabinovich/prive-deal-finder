import { IntegrationsService } from "./integrations.service";
import { IntegrationStatus } from "./connectors/types";

function prismaMock() {
  const metas: Record<string, string> = {};
  const mock: any = {
    integrationRun: {
      create: jest.fn(async () => ({ id: "run-1" })),
      update: jest.fn(async () => ({ startedAt: new Date() })),
    },
    integration: {
      findUnique: jest.fn(async ({ where }: any) => (where.source in metas ? { meta: metas[where.source] } : null)),
      upsert: jest.fn(async ({ where, update, create }: any) => {
        const meta = update?.meta ?? create?.meta;
        if (typeof meta === "string") metas[where.source] = meta;
        return {};
      }),
    },
    alertEvent: { upsert: jest.fn(async () => ({ id: "alert-1" })) },
    alertRule: { findMany: jest.fn(async () => []) },
    alertInboxItem: { createMany: jest.fn(async () => ({})) },
    stagingRecord: { createMany: jest.fn() },
    deal: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  return { mock, metas };
}

function servicioCon(resultado: Record<string, unknown>) {
  const { mock, metas } = prismaMock();
  const service = new IntegrationsService(mock, {} as any);
  const pb = (service as any).connectors.find((c: { source: string }) => c.source === "palm-beach-parcels");
  jest.spyOn(pb, "sync").mockResolvedValue(resultado);
  return { service, mock, metas };
}

describe("IntegrationsService: recorrido de parcelas", () => {
  const cursor = { clave: "abc123", offset: 400, vueltas: 0 };

  it("una pagina leida pero toda fuera del corredor igual avanza el cursor, sin ingerir nada", async () => {
    const { service, mock, metas } = servicioCon({
      status: IntegrationStatus.OK,
      message: "Palm Beach parcels: corridor page of 0 (read 200) from 200",
      records: [],
      cursor,
      metrics: { leidos: 200, fueraDelCorredor: 200 },
    });
    const r = await service.sync("palm-beach-parcels");
    expect(r.status).toBe(IntegrationStatus.OK);
    expect(JSON.parse(metas["palm-beach-parcels"]).cursorParcelas).toMatchObject({ clave: "abc123", offset: 400 });
    expect(mock.stagingRecord.createMany).not.toHaveBeenCalled();
  });

  it("si la fuente falla, el cursor no se mueve", async () => {
    const { service, metas } = servicioCon({ status: IntegrationStatus.ERROR, message: "fetch failed", cursor });
    await service.sync("palm-beach-parcels");
    expect(metas["palm-beach-parcels"]).toBeUndefined();
  });
});
