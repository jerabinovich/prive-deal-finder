import { CAMPOS_CIUDAD_DEL_SITIO, CAMPOS_ZIP_DEL_SITIO, normalizarZip, resolverZipDelSitio } from "./zip";

describe("normalizarZip, con los formatos reales de la base del 12-oct", () => {
  it("deja 5 digitos", () => {
    expect(normalizarZip("33132-0000")).toBe("33132");
    expect(normalizarZip("333231640")).toBe("33323");
    expect(normalizarZip("33480")).toBe("33480");
    expect(normalizarZip(33480)).toBe("33480");
    expect(normalizarZip(" 33133 ")).toBe("33133");
    expect(normalizarZip("33480.0")).toBe("33480");
  });

  it("lo que no es un zip queda en null: no se adivina", () => {
    for (const v of ["0", "00000", "", "   ", null, undefined, "FL", "3313", "331330", "33133-12"]) {
      expect(normalizarZip(v)).toBeNull();
    }
  });
});

describe("campos del sitio", () => {
  it("no usan los del dueno de Palm Beach", () => {
    for (const campo of ["ZIP1", "PSTLZIP5"]) expect(CAMPOS_ZIP_DEL_SITIO).not.toContain(campo);
    for (const campo of ["CITYNAME", "PSTLCITY"]) expect(CAMPOS_CIUDAD_DEL_SITIO).not.toContain(campo);
  });
});

describe("resolverZipDelSitio", () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });

  it("el de la capa manda y no consulta el Census", async () => {
    const espia = jest.fn();
    global.fetch = espia as unknown as typeof fetch;
    expect(await resolverZipDelSitio("33132-0000", 26.7, -80.1)).toBe("33132");
    expect(espia).not.toHaveBeenCalled();
  });

  it("sin zip en la capa, sale de las coordenadas", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { geographies: { "2020 Census ZIP Code Tabulation Areas": [{ ZCTA5: "33407" }] } } }),
    }) as unknown as typeof fetch;
    expect(await resolverZipDelSitio(undefined, 26.72942619505216, -80.05657664711559)).toBe("33407");
  });

  it("sin zip ni coordenadas, o si el Census falla, null", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("sin red")) as unknown as typeof fetch;
    expect(await resolverZipDelSitio("0", null, null)).toBeNull();
    expect(await resolverZipDelSitio("0", 26.1, -80.2)).toBeNull();
  });
});
