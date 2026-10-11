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
];

describe("un solo criterio de ruido", () => {
  it("evaluarRuido y computeTriageScore nunca se separan", () => {
    for (const c of CASOS) {
      const g = evaluarRuido(c);
      const t = computeTriageScore(c);
      expect({ caso: c.propertyUseCode, isNoise: g.isNoise }).toEqual({ caso: c.propertyUseCode, isNoise: t.isNoise });
    }
  });

  it("la tierra publica vendible deja de ser ruido y queda marcada P3", () => {
    for (const uso of ["COUNTY : DADE COUNTY", "MUNICIPAL : MUNICIPAL", "VACANT GOVERNMENTAL : VACANT LAND - GOVERNMENTAL"]) {
      const g = evaluarRuido({ propertyUseCode: uso, ownerNames: ["MIAMI-DADE COUNTY"] });
      expect({ uso, isNoise: g.isNoise, p3: g.esTierraP3 }).toEqual({ uso, isNoise: false, p3: true });
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
