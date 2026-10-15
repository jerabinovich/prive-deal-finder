import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fetchArcgisPagina } from "./arcgis-pagina";
import {
  CONDADOS_ESTATALES,
  TRAMO,
  corredorDe,
  corredoresEstatales,
  normalizarRegistroEstatal,
  rangoDelCondado,
  recorrerCondado,
  usoDelBuyBox,
} from "./parcelas-estatales";

jest.mock("./arcgis-pagina", () => ({ fetchArcgisPagina: jest.fn() }));
const pagina = fetchArcgisPagina as jest.MockedFunction<typeof fetchArcgisPagina>;

const MARTIN = CONDADOS_ESTATALES.find((c) => c.source === "martin-parcels")!;
const MONROE = CONDADOS_ESTATALES.find((c) => c.source === "monroe-parcels")!;

let ruta = "";
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "bb-estatal-"));
  ruta = join(dir, "buybox.json");
  writeFileSync(
    ruta,
    JSON.stringify({
      corredores_tier1: {
        _nota: "x",
        "Jupiter / Jupiter Island": { zips: ["33458", "33469", "33477", "33455"], municipios: ["Jupiter", "Jupiter Island"] },
        "Ocean Reef Club (Key Largo)": { zips: ["33037"], municipios: ["Ocean Reef"] },
        "Key West (Old Town)": { zips: ["33040"], municipios: ["Key West"] },
        "Sin municipios": { zips: ["33139"] },
        Tribeca: { zips: ["10007"] },
      },
    }),
  );
  pagina.mockReset();
});

const fila = (oid: number, extra: Record<string, unknown> = {}) => ({
  attributes: {
    OBJECTID: oid,
    CO_NO: 53,
    PARCEL_ID: `P-${oid}`,
    DOR_UC: "000",
    PHY_ADDR1: `${oid} BEACH RD`,
    PHY_ADDR2: " ",
    PHY_CITY: "JUPITER ISLAND",
    PHY_ZIPCD: 33455,
    OWN_NAME: "DUENO SA",
    ...extra,
  },
  geometry: { x: -80.1, y: 27.05 },
});

describe("catastro estatal: reglas", () => {
  it("usos del buy box por codigo DOR de 3 cifras", () => {
    for (const si of ["000", "003", "008", "010", "039", "049", "080", "086", "087", "088", "089"]) expect([si, usoDelBuyBox(si)]).toEqual([si, true]);
    for (const no of ["001", "004", "005", "009", "050", "082", "090", "094", "", "X", null]) expect([no, usoDelBuyBox(no)]).toEqual([no, false]);
  });

  it("solo zips de Florida; Nueva York y las notas quedan afuera", () => {
    const c = corredoresEstatales(ruta);
    expect(c.map((x) => x.nombre)).toEqual(["Jupiter / Jupiter Island", "Ocean Reef Club (Key Largo)", "Key West (Old Town)", "Sin municipios"]);
    expect(c[0].municipios).toEqual(["JUPITER", "JUPITERISLAND"]);
  });

  it("Martin: Jupiter Island si; Hobe Sound no; la ciudad postal JUPITER de Martin no es el pueblo de Jupiter", () => {
    const c = corredoresEstatales(ruta);
    expect(corredorDe({ PHY_ZIPCD: 33455, PHY_CITY: "JUPITER ISLAND" }, MARTIN, c)).toBe("Jupiter / Jupiter Island");
    expect(corredorDe({ PHY_ZIPCD: 33455, PHY_CITY: "HOBE SOUND" }, MARTIN, c)).toBeNull();
    expect(corredorDe({ PHY_ZIPCD: 33469, PHY_CITY: "JUPITER" }, MARTIN, c)).toBeNull();
  });

  it("Monroe: Key West la ciudad entera, Ocean Reef solo, sin Stock Island ni Key Largo", () => {
    const c = corredoresEstatales(ruta);
    expect(corredorDe({ PHY_ZIPCD: 33040, PHY_CITY: "Key West" }, MONROE, c)).toBe("Key West (Old Town)");
    expect(corredorDe({ PHY_ZIPCD: 33040, PHY_CITY: "STOCK ISLAND" }, MONROE, c)).toBeNull();
    expect(corredorDe({ PHY_ZIPCD: 33037, PHY_CITY: "OCEAN REEF" }, MONROE, c)).toBe("Ocean Reef Club (Key Largo)");
    expect(corredorDe({ PHY_ZIPCD: 33037, PHY_CITY: "KEY LARGO" }, MONROE, c)).toBeNull();
  });

  it("un corredor sin municipios toma todo su zip; sin zip no hay corredor", () => {
    const c = corredoresEstatales(ruta);
    expect(corredorDe({ PHY_ZIPCD: 33139, PHY_CITY: "CUALQUIERA" }, MONROE, c)).toBe("Sin municipios");
    expect(corredorDe({ PHY_ZIPCD: 0, PHY_CITY: "KEY WEST" }, MONROE, c)).toBeNull();
    expect(corredorDe({ PHY_CITY: "KEY WEST" }, MONROE, c)).toBeNull();
  });

  it("normaliza la fila con los nombres que lee la ingesta", () => {
    const r = normalizarRegistroEstatal({
      attributes: {
        PARCEL_ID: " 17-38-42-000-000-00030-0 ",
        DOR_UC: "087",
        PHY_ADDR1: "1 BEACH RD",
        PHY_ADDR2: "UNIT 2",
        PHY_CITY: "Key West",
        PHY_ZIPCD: 33040,
        OWN_NAME: "STATE OF FLORIDA",
        OWN_ADDR1: "3900 COMMONWEALTH BLVD",
        OWN_CITY: "TALLAHASSEE",
        OWN_STATE: "FL",
        OWN_ZIPCD: 32399,
        JV: 5260760,
        ACT_YR_BLT: 0,
        TOT_LVG_AR: 0,
        LND_SQFOOT: 28620,
      },
      geometry: { x: -81.8, y: 24.55 },
    });
    expect(r.attributes).toMatchObject({
      PARCEL_ID: "17-38-42-000-000-00030-0",
      USE_CODE: "87",
      SITUS_ADDRESS: "1 BEACH RD UNIT 2",
      SITUS_CITY: "KEY WEST",
      MUNICIPALITY: "KEY WEST",
      SITUS_ZIP: "33040",
      SITUS_STATE: "FL",
      OWN_NAME: "STATE OF FLORIDA",
      MAILING_ADDRESS: "3900 COMMONWEALTH BLVD, TALLAHASSEE, FL 32399",
      JUST_VALUE: 5260760,
      LAND_SQFT: 28620,
    });
    expect(r.attributes).not.toHaveProperty("ACT_YR_BLT");
    expect(r.attributes).not.toHaveProperty("TOT_LVG_AREA");
    expect(r.geometry).toEqual({ x: -81.8, y: 24.55 });
  });

  it("una direccion de relleno del rol no es direccion", () => {
    for (const relleno of ["UNASSIGNED", "VACANT LAND", " "]) {
      const r = normalizarRegistroEstatal({ attributes: { PARCEL_ID: "X", PHY_ADDR1: relleno, PHY_ADDR2: " " } });
      expect(r.attributes).not.toHaveProperty("SITUS_ADDRESS");
    }
  });
});

describe("catastro estatal: el recorrido", () => {
  const rango = { lo: 1000, hi: 6999, n: 5000 };
  const base = () => ({ cantidad: 3, rango, ruta, esperaMs: 0 });

  it("empieza en el primer OBJECTID del condado, con el condado y los zips en el WHERE", async () => {
    pagina.mockResolvedValueOnce([fila(1001), fila(1002)]).mockResolvedValue([]);
    const r = await recorrerCondado(MARTIN, null, base());
    const where = pagina.mock.calls[0][1];
    expect(where).toContain("CO_NO = 53 AND OBJECTID >= 1000 AND OBJECTID < 3000");
    expect(where).toContain("PHY_ZIPCD IN (33037,33040,33139,33455,33458,33469,33477)");
    expect(pagina.mock.calls[0][2]).toMatchObject({ offset: 0, cantidad: TRAMO, orden: "OBJECTID" });
    expect(r.desde).toBe(1000);
    expect(r.records.map((x) => x.attributes.PARCEL_ID)).toEqual(["P-1001", "P-1002"]);
  });

  it("corta al juntar la cantidad y sigue en la fila siguiente a la ultima tomada", async () => {
    pagina.mockResolvedValueOnce([fila(1001), fila(1002), fila(1003), fila(1004)]);
    const r = await recorrerCondado(MARTIN, null, base());
    expect(r.records).toHaveLength(3);
    expect(r.cursor).toMatchObject({ offset: 1004, vueltas: 0 });
    pagina.mockResolvedValueOnce([fila(1004), fila(1500)]).mockResolvedValue([]);
    const r2 = await recorrerCondado(MARTIN, r.cursor, base());
    expect(r2.desde).toBe(1004);
    expect(pagina.mock.calls[1][1]).toContain("OBJECTID >= 1004 AND OBJECTID < 3004");
    expect(r2.records.map((x) => x.attributes.PARCEL_ID)).toEqual(["P-1004", "P-1500"]);
  });

  it("filtra corredor, uso y repetidas, y lo cuenta", async () => {
    pagina
      .mockResolvedValueOnce([
        fila(1001),
        fila(1002, { PHY_CITY: "HOBE SOUND" }),
        fila(1003, { DOR_UC: "001" }),
        fila(1004, { PARCEL_ID: "P-1001" }),
      ])
      .mockResolvedValue([]);
    const r = await recorrerCondado(MARTIN, null, base());
    expect(r.records).toHaveLength(1);
    expect(r).toMatchObject({ leidos: 4, fueraDelCorredor: 1, fueraDelBuyBox: 1, repetidas: 1, porCorredor: { "Jupiter / Jupiter Island": 1 } });
  });

  it("al final del condado la proxima corrida vuelve al principio y suma una vuelta", async () => {
    pagina.mockResolvedValue([]);
    const r = await recorrerCondado(MARTIN, null, base());
    expect(r.tramos).toBe(3);
    expect(r.vuelta).toBe(0);
    expect(r.cursor).toMatchObject({ offset: 1000, vueltas: 1 });
    const r2 = await recorrerCondado(MARTIN, r.cursor, base());
    expect(r2.desde).toBe(1000);
    expect(r2.vuelta).toBe(1);
  });

  it("si cambian los corredores o el rango del condado, el recorrido empieza de cero", async () => {
    pagina.mockResolvedValueOnce([fila(1001), fila(1002), fila(1003)]);
    const r = await recorrerCondado(MARTIN, null, base());
    pagina.mockResolvedValueOnce([]).mockResolvedValue([]);
    const otro = await recorrerCondado(MARTIN, r.cursor, { ...base(), rango: { lo: 2000, hi: 7999, n: 5000 } });
    expect(otro.desde).toBe(2000);
    expect(otro.vuelta).toBe(0);
  });

  it("un cursor pasado del final empieza de nuevo y suma una vuelta", async () => {
    pagina.mockResolvedValueOnce([fila(1001), fila(1002), fila(1003)]);
    const r = await recorrerCondado(MARTIN, null, base());
    pagina.mockResolvedValue([]);
    const r2 = await recorrerCondado(MARTIN, { ...r.cursor, offset: 99999 }, base());
    expect(r2.desde).toBe(1000);
    expect(r2.vuelta).toBe(1);
  });

  it("respeta el tope de tiempo: corta despues del tramo en curso", async () => {
    let t = 0;
    pagina.mockResolvedValue([]);
    const r = await recorrerCondado(MARTIN, null, { ...base(), presupuestoMs: 10, reloj: () => (t += 20) });
    expect(r.tramos).toBe(1);
    expect(r.cursor).toMatchObject({ offset: 3000, vueltas: 0 });
  });

  it("reintenta una vez un tramo que falla; si falla dos veces, falla la corrida", async () => {
    pagina.mockRejectedValueOnce(new Error("ArcGIS query failed 504")).mockResolvedValueOnce([fila(1001)]).mockResolvedValue([]);
    const r = await recorrerCondado(MARTIN, null, base());
    expect(r.records).toHaveLength(1);
    pagina.mockReset();
    pagina.mockRejectedValue(new Error("ArcGIS query failed 504"));
    await expect(recorrerCondado(MARTIN, null, base())).rejects.toThrow("504");
  });
});

describe("catastro estatal: rango del condado", () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });

  it("pide min, max y conteo de OBJECTID del condado", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [{ attributes: { lo: 5617913, hi: 5716207, n: 97565 } }] }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(rangoDelCondado(MARTIN, "https://x/FeatureServer/0")).resolves.toEqual({ lo: 5617913, hi: 5716207, n: 97565 });
    const cuerpo = new URLSearchParams(String(fetchMock.mock.calls[0][1].body));
    expect(cuerpo.get("where")).toBe("CO_NO = 53");
    expect(cuerpo.get("outStatistics")).toContain("OBJECTID");
  });

  it("un condado sin filas o un error de ArcGIS es un error", async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ features: [{ attributes: { lo: null, hi: null, n: 0 } }] }) }) as unknown as typeof fetch;
    await expect(rangoDelCondado(MONROE, "https://x/FeatureServer/0")).rejects.toThrow("no tiene filas");
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ error: { message: "malo" } }) }) as unknown as typeof fetch;
    await expect(rangoDelCondado(MONROE, "https://x/FeatureServer/0")).rejects.toThrow("malo");
  });
});
