import { esConservacion, inferOwnerType } from "./deals.utils";
import { computeTriageScore, evaluarRuido } from "../scoring/score";
import { decidirOperacion } from "./operational-decision";
import type { EntradaDecision } from "./operational-decision";

const FWS = "C/O FISH & WILDLIFE SERVICE, 1875 CENTURY BLVD NE, ATLANTA, GA 30345";
const FEDERAL = "Federal, other than military, forests, parks, recreational areas, hospitals, colleges (DOR 88)";

function entrada(deal: EntradaDecision["deal"], owners: EntradaDecision["owners"]): EntradaDecision {
  return {
    deal: { parcelId: "35-38-42-001-001-00010-3", address: null, ...deal },
    owners,
    distressSignals: [],
    events: [],
    classification: "WATCHLIST" as EntradaDecision["classification"],
    completenessScore: 50,
    spreadToAskPct: null,
    comparableCount: 0,
  };
}

describe("tierra de conservacion (JR, 16 oct: quita P3)", () => {
  it("reconoce el dueno de conservacion", () => {
    for (const n of [
      "NATURE CONSERVANCY",
      "THE CONSERVATION FUND",
      "OCEAN REEF CONSERVATION ASSOCIATION INC",
      "OCEAN REEF CONSERVATION ASSOCI",
      "FLORIDA FISH AND WILDLIFE CONSERVATION COMMISSION",
      "NATIONAL AUDUBON SOCIETY INC",
      "U S FISH & WILDLIFE",
    ]) {
      expect([n, esConservacion([n])]).toEqual([n, true]);
    }
  });

  it("no confunde un fideicomiso privado, un consorcio ni una empresa", () => {
    for (const n of [
      "LAND TRUST AGREEMENT (SUZANNE HIGDON FARRAR TTEE)",
      "THE CONSERVANCY AT WESTON HOMEOWNERS ASSOCIATION",
      "CONSERVANCY CONDOMINIUM ASSOCIATION INC",
      "AUDUBON DEVELOPMENT LLC",
      "UNITED STATES OF AMERICA",
      "JOHN SMITH",
    ]) {
      expect([n, esConservacion([n])]).toEqual([n, false]);
    }
  });

  it("el domicilio cuenta solo con el nombre de la agencia, no con una calle", () => {
    expect(esConservacion(["UNITED STATES OF AMERICA"], FWS)).toBe(true);
    expect(esConservacion(["UNITED STATES OF AMERICA"], "C/O NATIONAL PARK SERVICE, 100 ALABAMA ST SW, ATLANTA, GA")).toBe(true);
    expect(esConservacion(["UNITED STATES OF AMERICA"], "C/O GENERAL SERVICES ADMINISTRATION, WASHINGTON, DC 20405")).toBe(false);
    expect(esConservacion(["JOHN SMITH"], "123 CONSERVANCY DR, NAPLES, FL 34110")).toBe(false);
    expect(esConservacion(["JOHN SMITH"], "45 AUDUBON AVE, WEST PALM BEACH, FL 33401")).toBe(false);
    expect(esConservacion([], null)).toBe(false);
  });

  it("el refugio federal es ruido de conservacion aunque el codigo DOR sea de gobierno; otro inmueble federal es ruido GOVERNMENT", () => {
    const refugio = evaluarRuido({ propertyUseCode: FEDERAL, ownerNames: ["UNITED STATES OF AMERICA"], mailingAddress: FWS });
    expect(refugio).toEqual({ isNoise: true, noiseReason: "CONSERVATION", esTierraP3: true });
    const gsa = evaluarRuido({ propertyUseCode: FEDERAL, ownerNames: ["UNITED STATES OF AMERICA"], mailingAddress: "C/O GSA, WASHINGTON, DC" });
    expect(gsa).toEqual({ isNoise: true, noiseReason: "GOVERNMENT", esTierraP3: true });
  });

  it("el score de la ingesta lo descarta con su motivo", () => {
    const r = computeTriageScore({ propertyUseCode: "Vacant Residential (DOR 00)", ownerNames: ["THE CONSERVATION FUND"], source: "martin-parcels" });
    expect(r).toMatchObject({ score: 0, isNoise: true, noiseReason: "CONSERVATION" });
    const privado = computeTriageScore({ propertyUseCode: "Vacant Residential (DOR 00)", ownerNames: ["JOHN SMITH"], source: "martin-parcels" });
    expect(privado.isNoise).toBe(false);
  });

  it("el carril: conservacion a ruido con su motivo, el resto del gobierno a ruido GOVERNMENT (25-oct)", () => {
    const refugio = decidirOperacion(entrada({ propertyUseCode: FEDERAL, mailingAddress: FWS }, [{ name: "UNITED STATES OF AMERICA" }]));
    expect(refugio).toMatchObject({ lane: "NON_ACQUIRABLE_NOISE", recommendedAction: "ARCHIVE", isNoise: true, noiseReason: "CONSERVATION" });
    expect(refugio.why[0]).toContain("Conservation land");
    const pueblo = decidirOperacion(entrada({ propertyUseCode: "Municipal, other than parks, recreational areas, colleges, hospitals (DOR 89)" }, [{ name: "TOWN OF JUPITER ISLAND" }]));
    expect(pueblo).toMatchObject({ lane: "NON_ACQUIRABLE_NOISE", recommendedAction: "ARCHIVE", isNoise: true, noiseReason: "GOVERNMENT" });
    expect(pueblo.why[0]).toContain("Government-owned");
    expect(inferOwnerType(["TOWN OF JUPITER ISLAND"])).toBe("GOV");
  });
});
