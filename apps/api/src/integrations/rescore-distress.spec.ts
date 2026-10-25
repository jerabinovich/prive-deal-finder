import { recalcularPuntaje } from "./rescore-distress";
import { computeTriageScore } from "../scoring/score";

// 25-oct-2026: el score de un deal al que catastro-valores le cargo el lote, con la etapa de distress GUARDADA.
const deal = {
  id: "d1", assetType: "MULTIFAMILY 10 UNITS PLUS", propertyUseCode: "0300", mailingAddress: null, city: "POMPANO BEACH",
  municipality: "POMPANO BEACH", state: "FL", yearBuilt: 1975, source: "broward-parcels", isNoise: false, noiseReason: null,
};

function prismaFalso(guardado: Record<string, unknown>) {
  return {
    deal: { findUnique: jest.fn().mockResolvedValue(guardado), update: jest.fn().mockResolvedValue({}) },
    dealOwner: { findMany: jest.fn().mockResolvedValue([{ owner: { name: "SEAVIEW HOLDINGS LLC" } }]) },
  };
}

const esperado = (lotSizeSqft: number | null, distressStage: string) => computeTriageScore({
  assetType: deal.assetType, propertyUseCode: deal.propertyUseCode, ownerNames: ["SEAVIEW HOLDINGS LLC"], mailingAddress: null,
  city: deal.city, municipality: deal.municipality, state: deal.state, yearBuilt: deal.yearBuilt, lotSizeSqft, source: deal.source,
  distressStage: distressStage as never,
});

describe("recalcularPuntaje (25-oct)", () => {
  it("el lote nuevo entra en el score y la etapa guardada no se toca", async () => {
    const sinLote = esperado(null, "NONE").score;
    const conLote = esperado(12000, "NONE").score;
    expect(conLote).not.toBe(sinLote);
    const prisma = prismaFalso({ ...deal, lotSizeSqft: 12000, distressStage: "NONE", score: sinLote });
    expect(await recalcularPuntaje(prisma as never, ["d1", "d1"])).toBe(1);
    expect(prisma.deal.update).toHaveBeenCalledTimes(1);
    const data = prisma.deal.update.mock.calls[0][0].data;
    expect(data.score).toBe(conLote);
    expect(data).not.toHaveProperty("distressStage");
  });

  it("GOVERNMENT_LAND sin senales sigue GOVERNMENT_LAND (recalcularDistressYPuntaje la pasaria a NONE)", async () => {
    const conLote = esperado(12000, "GOVERNMENT_LAND");
    const prisma = prismaFalso({ ...deal, lotSizeSqft: 12000, distressStage: "GOVERNMENT_LAND", score: -1 });
    await recalcularPuntaje(prisma as never, ["d1"]);
    const data = prisma.deal.update.mock.calls[0][0].data;
    expect(data).toEqual({ score: conLote.score, isNoise: conLote.isNoise, noiseReason: conLote.noiseReason });
  });

  it("si el score ya esta bien no escribe", async () => {
    const prisma = prismaFalso({ ...deal, lotSizeSqft: 12000, distressStage: "NONE", score: esperado(12000, "NONE").score });
    expect(await recalcularPuntaje(prisma as never, ["d1"])).toBe(0);
    expect(prisma.deal.update).not.toHaveBeenCalled();
  });
});
