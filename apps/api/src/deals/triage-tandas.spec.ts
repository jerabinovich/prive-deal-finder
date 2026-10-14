import { DealsService } from "./deals.service";

function deal(id: string) {
  return {
    id, lane: null, recommendedAction: null, distressStage: null, isNoise: false, noiseReason: null,
    contactabilityScore: null, nextEventDate: null, askingPrice: null, dataCompletenessScore: 50,
    parcelId: id, address: "1 TEST ST", mailingAddress: null, assetType: "STORE : RETAIL OUTLET",
    propertyUseCode: "STORE : RETAIL OUTLET", insight: null, owners: [], distressSignals: [], events: [],
    _count: { comparables: 0 },
  };
}

describe("triage en tandas", () => {
  it("procesa toda la seleccion en tandas de 500, sin el tope viejo de 5000", async () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `d${i}`);
    const findMany = jest.fn(async (args: { select?: unknown; take?: number; where?: { id?: { in: string[] } } }) => {
      if (args.select) return ids.slice(0, args.take).map((id) => ({ id }));
      return (args.where?.id?.in ?? []).map(deal);
    });
    const prisma = {
      deal: { findMany, update: jest.fn(() => ({})) },
      dealDecisionAudit: { create: jest.fn(() => ({})) },
      $transaction: jest.fn(async () => []),
    };
    const r = await new DealsService(prisma as never).recomputeOperationalTriage({ limit: 100000 });
    expect(r.processed).toBe(1200);
    expect(r.errors).toBe(0);
    expect(findMany.mock.calls[0][0]).toMatchObject({ orderBy: { updatedAt: "desc" }, take: 100000, select: { id: true } });
    expect(findMany.mock.calls.slice(1).map((c) => (c[0] as { where: { id: { in: string[] } } }).where.id.in.length)).toEqual([500, 500, 200]);
    expect(r.updated + r.skipped).toBe(1200);
  });

  it("el limite sigue mandando: 500 por defecto", async () => {
    const findMany = jest.fn(async (args: { select?: unknown; take?: number }) => (args.select ? [] : []));
    await new DealsService({ deal: { findMany } } as never).recomputeOperationalTriage({});
    expect(findMany.mock.calls[0][0].take).toBe(500);
  });
});
