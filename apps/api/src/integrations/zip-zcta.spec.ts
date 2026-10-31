import { FALLAS_PARA_CORTAR, PAUSA_MS, consultarZcta, reiniciarCorteCensus, zipGuardado, zipPorCoordenadas } from "./zip";

beforeEach(() => reiniciarCorteCensus());
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

describe("corte del Census (31-oct)", () => {
  const conZcta = (zip: string) =>
    respuesta({ result: { geographies: { "2020 Census ZIP Code Tabulation Areas": [{ ZCTA5: zip }] } } });

  it("despues de fallas seguidas no le pregunta mas durante la pausa; despues vuelve a preguntar", async () => {
    let ahora = 1_000_000;
    jest.spyOn(Date, "now").mockImplementation(() => ahora);
    const espia = jest.spyOn(global, "fetch").mockRejectedValue(new Error("timeout"));
    for (let i = 0; i < FALLAS_PARA_CORTAR; i += 1) {
      await expect(consultarZcta(26.4 + i / 100, -80.1)).resolves.toEqual({ respondio: false, zip: null });
    }
    expect(espia).toHaveBeenCalledTimes(FALLAS_PARA_CORTAR);
    espia.mockResolvedValue(conZcta("33401"));
    await expect(consultarZcta(26.71, -80.05)).resolves.toEqual({ respondio: false, zip: null });
    expect(espia).toHaveBeenCalledTimes(FALLAS_PARA_CORTAR);
    ahora += PAUSA_MS + 1;
    await expect(consultarZcta(26.71, -80.05)).resolves.toEqual({ respondio: true, zip: "33401" });
    expect(espia).toHaveBeenCalledTimes(FALLAS_PARA_CORTAR + 1);
  });

  it("un HTTP con error o una respuesta sin geografias tambien son fallas", async () => {
    const espia = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(respuesta({}, false))
      .mockResolvedValueOnce(respuesta({ result: {} }))
      .mockRejectedValueOnce(new Error("red"))
      .mockResolvedValue(conZcta("33401"));
    for (const lat of [26.51, 26.52, 26.53, 26.54]) await consultarZcta(lat, -80.1);
    expect(espia).toHaveBeenCalledTimes(3);
  });

  it("\"no hay ZCTA\" es una respuesta: corta la racha de fallas", async () => {
    const espia = jest
      .spyOn(global, "fetch")
      .mockRejectedValueOnce(new Error("red"))
      .mockRejectedValueOnce(new Error("red"))
      .mockResolvedValueOnce(respuesta({ result: { geographies: { "2020 Census ZIP Code Tabulation Areas": [] } } }))
      .mockRejectedValueOnce(new Error("red"))
      .mockRejectedValueOnce(new Error("red"))
      .mockResolvedValue(conZcta("33401"));
    for (const lat of [26.61, 26.62, 26.63, 26.64, 26.65]) await consultarZcta(lat, -80.1);
    await expect(consultarZcta(26.66, -80.1)).resolves.toEqual({ respondio: true, zip: "33401" });
    expect(espia).toHaveBeenCalledTimes(6);
  });
});

describe("zipGuardado (31-oct)", () => {
  const deal = { zip: "33401", latitude: 26.712345, longitude: -80.054321 };
  it("misma parcela en el mismo punto: su zip", () => {
    expect(zipGuardado(deal, 26.712345, -80.054321)).toBe("33401");
    expect(zipGuardado({ ...deal, zip: "334011234" }, 26.7123451, -80.0543209)).toBe("33401");
  });
  it("se movio, no tiene zip, el zip no sirve o faltan coordenadas: null", () => {
    expect(zipGuardado(deal, 26.712346, -80.054321)).toBeNull();
    expect(zipGuardado({ ...deal, zip: null }, 26.712345, -80.054321)).toBeNull();
    expect(zipGuardado({ ...deal, zip: "0" }, 26.712345, -80.054321)).toBeNull();
    expect(zipGuardado({ ...deal, latitude: null }, 26.712345, -80.054321)).toBeNull();
    expect(zipGuardado(deal, undefined, -80.054321)).toBeNull();
    expect(zipGuardado(null, 26.712345, -80.054321)).toBeNull();
  });
});
