import { consultarZcta, zipPorCoordenadas } from "./zip";

afterEach(() => jest.restoreAllMocks());

const respuesta = (cuerpo: unknown, ok = true) => ({ ok, json: async () => cuerpo }) as Response;

describe("consultarZcta", () => {
  it("contesto con ZCTA", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      respuesta({ result: { geographies: { "2020 Census ZIP Code Tabulation Areas": [{ ZCTA5: "33311" }] } } }),
    );
    await expect(consultarZcta(26.11, -80.11)).resolves.toEqual({ respondio: true, zip: "33311" });
  });

  it("contesto pero el punto no cae en ninguna ZCTA: no es una falla", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(
      respuesta({ result: { geographies: { "2020 Census ZIP Code Tabulation Areas": [] } } }),
    );
    await expect(consultarZcta(26.22, -80.55)).resolves.toEqual({ respondio: true, zip: null });
  });

  it("no contesto: falla, y no queda en cache", async () => {
    const espia = jest.spyOn(global, "fetch").mockRejectedValueOnce(new Error("red"));
    await expect(consultarZcta(26.33, -80.33)).resolves.toEqual({ respondio: false, zip: null });
    espia.mockResolvedValueOnce(
      respuesta({ result: { geographies: { "2020 Census ZIP Code Tabulation Areas": [{ ZCTA5: "33068" }] } } }),
    );
    await expect(zipPorCoordenadas(26.33, -80.33)).resolves.toBe("33068");
  });
});
