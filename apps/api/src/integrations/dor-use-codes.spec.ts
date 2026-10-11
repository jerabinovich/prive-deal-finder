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
    // 28-sep-2026: 80, 86, 87, 88 y 89 SALIERON de este set por decision de JR.
    // Tierra publica que puede ser excedente y venderse: va al carril
    // GOV_LAND_P3, que existia vacio porque este set lo tapaba. Militar (81),
    // parques (82), escuelas (83), colleges (84) y hospitales publicos (85) se
    // quedan, esos no se compran.
    for (const c of ["09", "81", "82", "83", "84", "85", "94", "95", "96", "98"]) {
      expect({ c, no: isNonAcquirableDorCode(c) }).toEqual({ c, no: true });
    }
    for (const c of ["80", "86", "87", "88", "89"]) {
      expect({ c, no: isNonAcquirableDorCode(c) }).toEqual({ c, no: false });
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
