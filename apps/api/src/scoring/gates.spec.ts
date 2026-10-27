import { evaluarRuido, computeTriageScore } from "./score";

const CASOS = [
  { propertyUseCode: "Right-of-way, streets, roads, irrigation channel, ditch (DOR 94)", ownerNames: ["JUAN PEREZ"] },
  { propertyUseCode: "Single Family (DOR 01)", ownerNames: ["ACME LLC"] },
  { propertyUseCode: "COUNTY : DADE COUNTY", ownerNames: ["MIAMI-DADE COUNTY"] },
  { propertyUseCode: "MUNICIPAL : MUNICIPAL", ownerNames: ["CITY OF MIAMI"] },
  { propertyUseCode: "VACANT GOVERNMENTAL : VACANT LAND - GOVERNMENTAL", ownerNames: ["MIAMI-DADE COUNTY"] },
  { propertyUseCode: "Forest, parks, recreational areas (DOR 82)", ownerNames: ["BROWARD COUNTY"] },
  { propertyUseCode: "MULTIFAMILY 10 UNITS PLUS : MULTIFAMILY 3 OR MORE UNITS", ownerNames: ["BRICKELL HOLDINGS LLC"] },
  { propertyUseCode: "RESIDENTIAL COMMON AREA/ELEMENT", ownerNames: ["SOME HOA"] },
  // 25-oct-2026: el caso real que se separaba (10 parcelas de Palm Beach): distrito de agua sobre codigo de gobierno.
  { propertyUseCode: "DISTRICTS", ownerNames: ["SOUTH FLA WATER MGMT DIST"] },
  { propertyUseCode: "VACANT LAND - COMMERCIAL : VACANT LAND", ownerNames: ["MIAMI-DADE COUNTY"] },
  { propertyUseCode: "Golf courses, driving ranges (DOR 38)", ownerNames: ["CITY OF POMPANO BEACH"] },
  { propertyUseCode: "Vacant Residential (DOR 00)", ownerNames: ["FLORIDA POWER & LIGHT CO"] },
];

describe("un solo criterio de ruido", () => {
  it("evaluarRuido y computeTriageScore nunca se separan", () => {
    for (const c of CASOS) {
      const g = evaluarRuido(c);
      const t = computeTriageScore(c);
      expect({ caso: c.propertyUseCode, isNoise: g.isNoise, motivo: g.noiseReason })
        .toEqual({ caso: c.propertyUseCode, isNoise: t.isNoise, motivo: t.noiseReason });
    }
  });

  it("25-oct-2026 (JR): la tierra de gobierno es ruido GOVERNMENT, sigue marcada como tierra de gobierno", () => {
    for (const uso of ["COUNTY : DADE COUNTY", "MUNICIPAL : MUNICIPAL", "VACANT GOVERNMENTAL : VACANT LAND - GOVERNMENTAL"]) {
      const g = evaluarRuido({ propertyUseCode: uso, ownerNames: ["MIAMI-DADE COUNTY"] });
      expect({ uso, isNoise: g.isNoise, motivo: g.noiseReason, p3: g.esTierraP3 }).toEqual({ uso, isNoise: true, motivo: "GOVERNMENT", p3: true });
    }
  });

  it("parques, militar, escuelas y hospitales publicos siguen siendo ruido", () => {
    for (const uso of [
      "Forest, parks, recreational areas (DOR 82)",
      "Military (DOR 81)",
      "Public county schools (DOR 83)",
      "Hospitals (non private) (DOR 85)",
    ]) {
      expect({ uso, n: evaluarRuido({ propertyUseCode: uso, ownerNames: [] }).isNoise }).toEqual({ uso, n: true });
    }
  });
});
