import { toDorCode, isNonAcquirableDorCode, isGovP3DorCode, resolveDorUseCode } from "./dor-use-codes";

describe("vocabularios de condado a codigo DOR", () => {
  it("Broward: numero pelado y sufijo, regresion, no cambia", () => {
    expect(toDorCode("01")).toBe("01");
    expect(toDorCode("3")).toBe("03");
    expect(toDorCode("Single Family (DOR 01)")).toBe("01");
    expect(isNonAcquirableDorCode("Right-of-way, streets, roads, irrigation channel, ditch (DOR 94)")).toBe(true);
    expect(isNonAcquirableDorCode("Multi-family - 10 units or more (DOR 03)")).toBe(false);
  });

  it("Miami-Dade: manda la categoria antes de los dos puntos", () => {
    expect(toDorCode("MULTIFAMILY 10 UNITS PLUS : MULTIFAMILY 3 OR MORE UNITS")).toBe("03");
    expect(toDorCode("MULTIFAMILY 2-9 UNITS : 2 LIVING UNITS")).toBe("08");
    expect(toDorCode("RESIDENTIAL - SINGLE FAMILY : CLUSTER HOME")).toBe("01");
    expect(toDorCode("OFFICE BUILDING - ONE STORY : OFFICE BUILDING")).toBe("17");
    expect(toDorCode("COMMUNITY SHOPPING CENTER : COMMERCIAL - TOTAL VALUE")).toBe("16");
  });

  it("Miami-Dade: lo que el GATE 0 no veia y ahora si descarta", () => {
    for (const v of [
      "CENTRALLY ASSESSED : RAILROAD ASSESSMENT",
      "PVT PARK -REC AREA -ROADWAY : COMMON AREA",
    ]) {
      expect({ v, no: isNonAcquirableDorCode(v) }).toEqual({ v, no: true });
    }
  });

  it("Miami-Dade: la tierra publica vendible NO es ruido, es carril P3", () => {
    for (const v of [
      "COUNTY : DADE COUNTY",
      "MUNICIPAL : MUNICIPAL",
      "VACANT GOVERNMENTAL : VACANT LAND - GOVERNMENTAL",
    ]) {
      expect({ v, ruido: isNonAcquirableDorCode(v), p3: isGovP3DorCode(v) })
        .toEqual({ v, ruido: false, p3: true });
    }
  });

  it("Palm Beach: el valor entero es la categoria", () => {
    expect(toDorCode("CONDOMINIUM")).toBe("04");
    expect(toDorCode("MFR 5 TO 9 UNITS")).toBe("08");
    expect(toDorCode("WAREH/DIST TERM CONDO")).toBe("48");
    expect(toDorCode("OFFICE BLDG-NON MEDICAL 1 TO 3 STORIES")).toBe("17");
    expect(isNonAcquirableDorCode("RESIDENTIAL COMMON AREA/ELEMENT")).toBe(true);
    expect(isNonAcquirableDorCode("VACANT COMMERCIAL LAND")).toBe(false);
  });

  it("lo desconocido queda sin codigo, no se inventa", () => {
    expect(toDorCode("REFERENCE FOLIO")).toBeUndefined();
    expect(toDorCode("ALGO QUE NO EXISTE")).toBeUndefined();
    expect(isNonAcquirableDorCode("REFERENCE FOLIO")).toBe(false);
    expect(toDorCode(null)).toBeUndefined();
    expect(toDorCode("")).toBeUndefined();
  });

  it("resolveDorUseCode no se toco", () => {
    expect(resolveDorUseCode("01")).toBe("Single Family (DOR 01)");
    expect(resolveDorUseCode("CONDOMINIUM")).toBe("CONDOMINIUM");
  });
});
