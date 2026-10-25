import { recalcularDistressYPuntaje, recalcularPuntaje } from "./rescore-distress";
import { decidirDistress } from "../deals/distress-classification";
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

  it("si solo cambia el motivo de ruido, tambien lo guarda (revision del PR 17)", async () => {
    const e = esperado(12000, "NONE");
    const prisma = prismaFalso({ ...deal, lotSizeSqft: 12000, distressStage: "NONE", score: e.score, isNoise: e.isNoise, noiseReason: "MOTIVO_VIEJO" });
    expect(await recalcularPuntaje(prisma as never, ["d1"])).toBe(1);
    expect(prisma.deal.update.mock.calls[0][0].data.noiseReason).toBe(e.noiseReason);
  });

  it("si el score ya esta bien no escribe", async () => {
    const prisma = prismaFalso({ ...deal, lotSizeSqft: 12000, distressStage: "NONE", score: esperado(12000, "NONE").score });
    expect(await recalcularPuntaje(prisma as never, ["d1"])).toBe(0);
    expect(prisma.deal.update).not.toHaveBeenCalled();
  });
});

describe("recalcularDistressYPuntaje y GOVERNMENT_LAND (25-oct)", () => {
  // Un inmueble de un gobierno sin senales es GOVERNMENT_LAND, la misma regla que el triage (decidirOperacion). Antes
  // esta funcion lo pasaba a NONE: medido el 25-oct, 941 deals con GOVERNMENT_LAND y sin senales.
  function prismaDistress(guardado: Record<string, unknown>, senales: unknown[] = [], duenos: string[] = []) {
    return {
      dealDistressSignal: { findMany: jest.fn().mockResolvedValue(senales) },
      deal: { findUnique: jest.fn().mockResolvedValue(guardado), update: jest.fn().mockResolvedValue({}) },
      dealOwner: { findMany: jest.fn().mockResolvedValue(duenos.map((name) => ({ owner: { name } }))) },
    };
  }
  const base = { ...deal, score: -1, isNoise: false, noiseReason: null };

  it("sin senales y con codigo de gobierno: sigue GOVERNMENT_LAND", async () => {
    const prisma = prismaDistress({ ...base, propertyUseCode: "Vacant Governmental (DOR 80)", assetType: "Vacant Governmental (DOR 80)", distressStage: "GOVERNMENT_LAND" });
    await recalcularDistressYPuntaje(prisma as never, ["d1"]);
    expect(prisma.deal.update.mock.calls[0][0].data.distressStage).toBe("GOVERNMENT_LAND");
  });

  it("sin senales y con dueno de gobierno: GOVERNMENT_LAND", async () => {
    const prisma = prismaDistress({ ...base, distressStage: "NONE" }, [], ["CITY OF POMPANO BEACH"]);
    await recalcularDistressYPuntaje(prisma as never, ["d1"]);
    expect(prisma.deal.update.mock.calls[0][0].data.distressStage).toBe("GOVERNMENT_LAND");
  });

  it("sin senales y sin gobierno: NONE", async () => {
    const prisma = prismaDistress({ ...base, distressStage: "SIGNALS_ONLY" }, [], ["SEAVIEW HOLDINGS LLC"]);
    await recalcularDistressYPuntaje(prisma as never, ["d1"]);
    expect(prisma.deal.update.mock.calls[0][0].data.distressStage).toBe("NONE");
  });

  it("con senales manda la decision de las senales, como en el triage", async () => {
    const senales = [{ dealId: "d1", source: "miami-dade-code-enforcement", metadata: JSON.stringify({ PROBLEM_DESC: "OVERGROWTH", STATUS: "OPEN" }) }];
    const esperado = decidirDistress(senales, "Vacant Governmental (DOR 80)").stage;
    const prisma = prismaDistress({ ...base, propertyUseCode: "Vacant Governmental (DOR 80)", distressStage: "GOVERNMENT_LAND" }, senales);
    await recalcularDistressYPuntaje(prisma as never, ["d1"]);
    expect(prisma.deal.update.mock.calls[0][0].data.distressStage).toBe(esperado);
  });
});
