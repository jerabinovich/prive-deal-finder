import { computeTriageScore, MAX_SCORE_WITHOUT_DISTRESS } from "./score";

/**
 * Los casos salen de datos REALES de la base (12-sep-2026), no inventados.
 * El objetivo principal de esta suite es que el bug original no pueda volver:
 * un registro completo de basura NO puede puntuar alto.
 */
describe("computeTriageScore", () => {
  describe("gates de knockout", () => {
    it("descarta una parcela de ferrocarril (habia 5 en la base, puntuaban 85)", () => {
      const r = computeTriageScore({
        assetType: "CENTRALLY ASSESSED : RAILROAD ASSESSMENT",
        propertyUseCode: "CENTRALLY ASSESSED : RAILROAD ASSESSMENT",
        city: "MIAMI", state: "FL", ownerNames: ["FLORIDA EAST COAST RAILWAY LLC"],
      });
      expect(r.score).toBe(0);
      expect(r.isNoise).toBe(true);
      expect(r.noiseReason).toBe("RAILROAD");
    });

    it("descarta un area comun (puntuaba 100)", () => {
      const r = computeTriageScore({
        assetType: "RESIDENTIAL COMMON AREA/ELEMENT",
        propertyUseCode: "RESIDENTIAL COMMON AREA/ELEMENT",
        city: "WEST PALM BEACH", state: "FL", ownerNames: ["SOME HOA INC"],
      });
      expect(r.score).toBe(0);
      expect(r.isNoise).toBe(true);
    });

    it("descarta tierra gubernamental", () => {
      const r = computeTriageScore({
        assetType: "VACANT GOVERNMENTAL : VACANT LAND - GOVERNMENTAL",
        propertyUseCode: "VACANT GOVERNMENTAL : VACANT LAND - GOVERNMENTAL",
        city: "MIAMI", state: "FL",
      });
      expect(r.score).toBe(0);
      expect(r.isNoise).toBe(true);
    });

    it("descarta por propietario que no transacciona, aunque el activo sirva", () => {
      const r = computeTriageScore({
        assetType: "VACANT COMMERCIAL LAND", city: "WEST PALM BEACH", state: "FL",
        ownerNames: ["PALM BEACH COUNTY"],
      });
      expect(r.score).toBe(0);
      expect(r.isNoise).toBe(true);
    });
  });

  describe("REGRESION: los pantanos no son terreno desarrollable", () => {
    it("DOR 96 (pantanos, basurales) se descarta, aunque su texto diga 'waste LAND'", () => {
      // La descripcion oficial del DOR 96 contiene la palabra "land", y el
      // \bLAND\b de la escalera de activos la tomaba como terreno core:
      // medido, un pantano puntuaba 45/100.
      const r = computeTriageScore({
        assetType: "Sewage disposal, solid waste, borrow pits, drainage reservoirs, waste land, marsh, sand dunes, swamps (DOR 96)",
        propertyUseCode: "96", city: "PA", state: "FL",
        ownerNames: ["ACME LLC"], source: "broward-parcels",
      });
      expect(r.score).toBe(0);
      expect(r.isNoise).toBe(true);
    });

    it("DOR 95 (tierras sumergidas) tampoco", () => {
      const r = computeTriageScore({
        assetType: "Rivers and lakes, submerged lands (DOR 95)", propertyUseCode: "95",
        city: "PA", state: "FL", ownerNames: ["ACME LLC"], source: "broward-parcels",
      });
      expect(r.score).toBe(0);
    });

    it("pero el terreno de verdad sigue arriba", () => {
      const r = computeTriageScore({
        assetType: "Vacant Commercial (DOR 10)", propertyUseCode: "10",
        city: "PA", state: "FL", ownerNames: ["ACME LLC"], source: "broward-parcels",
      });
      expect(r.isNoise).toBe(false);
      expect(r.score).toBeGreaterThanOrEqual(40);
    });
  });

  describe("REGRESION: el bug original no puede volver", () => {
    it("un registro COMPLETO de basura no puede puntuar alto", () => {
      const basuraCompleta = computeTriageScore({
        assetType: "CENTRALLY ASSESSED : RAILROAD ASSESSMENT",
        propertyUseCode: "CENTRALLY ASSESSED : RAILROAD ASSESSMENT",
        city: "MIAMI", municipality: "MIAMI", state: "FL",
        ownerNames: ["FEC RAILWAY LLC"], yearBuilt: 1950, lotSizeSqft: 900000,
      });
      // Con el score viejo esto daba 85-100 por tener todos los campos.
      expect(basuraCompleta.score).toBe(0);
    });

    it("la completitud por si sola NO suma: dos activos iguales puntuan igual", () => {
      const base = { assetType: "CONDOMINIUM", city: "WEST PALM BEACH", state: "FL",
                     ownerNames: ["JUAN PEREZ"] };
      const magro = computeTriageScore({ ...base });
      const gordo = computeTriageScore({ ...base, municipality: "WEST PALM BEACH" });
      expect(gordo.score).toBe(magro.score);
    });
  });

  describe("pesos del playbook", () => {
    it("land/multifamily en mercado core rankea arriba de un condo en el mismo mercado", () => {
      const land = computeTriageScore({
        assetType: "VACANT COMMERCIAL LAND", city: "WEST PALM BEACH", state: "FL",
        ownerNames: ["MELROSE CAMERFORD PARTNERS LLC"],
      });
      const condo = computeTriageScore({
        assetType: "CONDOMINIUM", city: "WEST PALM BEACH", state: "FL",
        ownerNames: ["MELROSE CAMERFORD PARTNERS LLC"],
      });
      expect(land.score).toBeGreaterThan(condo.score);
    });

    it("el condado core se reconoce por la FUENTE aunque la ciudad sea un codigo", () => {
      // Broward manda SITUS_CITY como codigo de 2 letras ("PA" = Parkland).
      // Sin la regla por fuente, todo el condado caia fuera del core.
      const porFuente = computeTriageScore({
        assetType: "CONDOMINIUM", city: "PA", state: "FL",
        ownerNames: ["JUAN PEREZ"], source: "broward-parcels",
      });
      const sinFuente = computeTriageScore({
        assetType: "CONDOMINIUM", city: "PA", state: "FL",
        ownerNames: ["JUAN PEREZ"],
      });
      expect(porFuente.score).toBeGreaterThan(sinFuente.score);
      expect(porFuente.reasons.join(" ")).toContain("mercado core");
    });

    it("el mismo activo puntua mas en mercado core que fuera", () => {
      const core = computeTriageScore({ assetType: "MULTIFAMILY < 5 UNITS", city: "WEST PALM BEACH", state: "FL" });
      const fuera = computeTriageScore({ assetType: "MULTIFAMILY < 5 UNITS", city: "OCALA", state: "FL" });
      const lejos = computeTriageScore({ assetType: "MULTIFAMILY < 5 UNITS", city: "PHOENIX", state: "AZ" });
      expect(core.score).toBeGreaterThan(fuera.score);
      expect(fuera.score).toBeGreaterThan(lejos.score);
    });
  });

  describe("techo sin distress", () => {
    it("sin senal de distress nada supera el techo declarado", () => {
      const mejorCasoPosible = computeTriageScore({
        assetType: "MULTIFAMILY / MIXED-USE LAND", city: "MIAMI", municipality: "MIAMI", state: "FL",
        ownerNames: ["ACME HOLDINGS LLC"], yearBuilt: 1960, lotSizeSqft: 50000,
      });
      expect(mejorCasoPosible.score).toBeLessThanOrEqual(MAX_SCORE_WITHOUT_DISTRESS);
    });

    it("el distress domina: una subasta programada supera cualquier cosa sin distress", () => {
      const sinDistress = computeTriageScore({
        assetType: "MULTIFAMILY", city: "MIAMI", state: "FL",
        ownerNames: ["ACME LLC"], yearBuilt: 1960, lotSizeSqft: 50000,
      });
      const conSubasta = computeTriageScore({
        assetType: "CONDOMINIUM", city: "MIAMI", state: "FL",
        ownerNames: ["JUAN PEREZ"], distressStage: "AUCTION_SCHEDULED",
      });
      expect(conSubasta.score).toBeGreaterThan(sinDistress.score);
    });
  });

  it("siempre explica por que", () => {
    const r = computeTriageScore({ assetType: "VACANT COMMERCIAL LAND", city: "WEST PALM BEACH", state: "FL" });
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.reasons.join(" ")).toContain("mercado core");
  });
});
