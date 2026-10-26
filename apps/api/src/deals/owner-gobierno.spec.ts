import { esNombreDeGobierno, inferOwnerType } from "./deals.utils";
import { evaluarRuido } from "../scoring/score";

describe("dueno gobierno (JR, 15 oct: a P3)", () => {
  it("reconoce condado, ciudad, estado, town y village; no una entidad privada que nombra un condado", () => {
    for (const n of ["MIAMI-DADE COUNTY", "CITY OF MIAMI", "CITY OF POMPANO BEACH", "WELLINGTON VILLAGE OF", "DELRAY BEACH CITY OF",
      "TOWN OF DAVIE, A FLORIDA MUNICIPAL CORPORATION", "STATE OF FLORIDA", "SCHOOL BOARD OF BROWARD COUNTY"]) {
      expect([n, esNombreDeGobierno(n)]).toEqual([n, true]);
    }
    // 25-oct-2026 (revision de Codex del PR 26): federal, departamentos, autoridades publicas y distritos especiales.
    for (const n of ["UNITED STATES OF AMERICA", "FLORIDA DEPARTMENT OF TRANSPORTATION", "STATE OF FLA DEPT OF TRANSPORTATION",
      "BOARD OF TRUSTEES OF THE INTERNAL IMPROVEMENT TRUST FUND", "BOCA RATON AIRPORT AUTHORITY", "BOCA RATON AIRPORT AUTHORITY LESSOR",
      "BOCA RATON HOUSING AUTHORITY", "HOUSING AUTHORITY OF THE CITY", "GREATER BOCA RATON BEACH & PARK DIST",
      "LOWER FL KEYS HOSPITAL DIST", "SOUTH FLA WATER MGMT DIST"]) {
      expect([n, esNombreDeGobierno(n)]).toEqual([n, true]);
    }
    for (const n of ["UNITED WAY OF BROWARD COUNTY INC", "COUNTY LINE PLAZA LLC", "CITY OF MIAMI BEACH CHURCH INC", "VILLAGE OF KINGS CREEK CONDO ASSOC", "ACME HOLDINGS LLC",
      "3925 DESIGN DISTRICT LLC", "DESIGN DISTRICT ASSOC (DEL) LL", "7300 NORTH FEDERAL INVESTMENTS LLC", "FIRST STATE BANK OF THE FLORID",
      "AUTHORITY PROPERTIES LLC", "ISLAND INSURANCE AGENCY INC"]) {
      expect([n, esNombreDeGobierno(n)]).toEqual([n, false]);
    }
  });

  it("el tipo de dueno: gobierno si alguno lo es; HOA y utility como antes", () => {
    expect(inferOwnerType(["JOHN SMITH", "CITY OF MIAMI"])).toBe("GOV");
    expect(inferOwnerType(["UNITED WAY OF BROWARD COUNTY INC"])).toBe("PRIVATE");
    expect(inferOwnerType(["SUNRISE HOMEOWNERS ASSOCIATION"])).toBe("HOA");
    expect(inferOwnerType([])).toBe("UNKNOWN");
  });

  it("25-oct-2026 (JR): un inmueble de un gobierno es ruido GOVERNMENT; parques y calles siguen siendo ruido", () => {
    expect(evaluarRuido({ propertyUseCode: "VACANT LAND - COMMERCIAL : VACANT LAND", ownerNames: ["MIAMI-DADE COUNTY"] }))
      .toMatchObject({ isNoise: true, noiseReason: "GOVERNMENT" });
    expect(evaluarRuido({ propertyUseCode: "Golf courses, driving ranges (DOR 38)", ownerNames: ["CITY OF POMPANO BEACH"] }))
      .toMatchObject({ isNoise: true, noiseReason: "GOVERNMENT" });
    expect(evaluarRuido({ propertyUseCode: "Golf courses, driving ranges (DOR 38)", ownerNames: ["ACME GOLF LLC"] }).isNoise).toBe(false);
    expect(evaluarRuido({ propertyUseCode: "Forest, parks, recreational areas (DOR 82)", ownerNames: ["BROWARD COUNTY"] }).isNoise).toBe(true);
    expect(evaluarRuido({ propertyUseCode: "Right-of-way, streets, roads, irrigation channel, ditch (DOR 94)", ownerNames: ["BROWARD COUNTY"] }).isNoise).toBe(true);
  });
});

