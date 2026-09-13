import { resolveDorUseCode, isNonAcquirableDorCode } from "./dor-use-codes";

describe("codigos DOR de Florida", () => {
  it("traduce el codigo pelado que manda Broward", () => {
    expect(resolveDorUseCode("01")).toContain("Single Family");
    expect(resolveDorUseCode("08")).toContain("Multi-family");
    expect(resolveDorUseCode("1")).toContain("Single Family"); // sin cero a la izquierda
  });

  it("NO toca el texto que mandan Palm Beach y Miami-Dade", () => {
    expect(resolveDorUseCode("VACANT COMMERCIAL LAND")).toBe("VACANT COMMERCIAL LAND");
    expect(resolveDorUseCode("MULTIFAMILY < 5 UNITS")).toBe("MULTIFAMILY < 5 UNITS");
  });

  it("marca como no adquirible el rango gubernamental y las servidumbres", () => {
    for (const c of ["80", "82", "86", "89", "94", "95", "96", "98", "09"]) {
      expect(isNonAcquirableDorCode(c)).toBe(true);
    }
  });

  it("NO marca lo que si se puede comprar", () => {
    for (const c of ["00", "01", "08", "10", "39", "48", "52"]) {
      expect(isNonAcquirableDorCode(c)).toBe(false);
    }
  });

  it("reconoce el codigo dentro de la etiqueta ya traducida", () => {
    expect(isNonAcquirableDorCode(resolveDorUseCode("94"))).toBe(true);
    expect(isNonAcquirableDorCode(resolveDorUseCode("01"))).toBe(false);
  });
});
