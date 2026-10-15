import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fetchArcgisPagina } from "../arcgis-pagina";
import { CAPA_PALM_BEACH } from "../parcelas-palm-beach";
import { PalmBeachParcelsConnector } from "./palm-beach-parcels.connector";

jest.mock("../arcgis-pagina", () => ({ fetchArcgisPagina: jest.fn() }));
const pagina = fetchArcgisPagina as jest.MockedFunction<typeof fetchArcgisPagina>;

const ENV = { ...process.env };
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "bb-pb-"));
  writeFileSync(
    join(dir, "buybox.json"),
    JSON.stringify({
      corredores_tier1: {
        "Palm Beach": { zips: ["33480"], municipios: ["Palm Beach"] },
        "West Palm Beach (Downtown / Flagler)": { zips: ["33401"], municipios: ["West Palm Beach"] },
      },
    }),
  );
  process.env.BUYBOX_JSON = join(dir, "buybox.json");
  process.env.PARCELAS_POR_CORRIDA = "3";
  process.env.PALM_BEACH_PARCELS_URL = "https://services1.arcgis.com/RTiKiFNGzgAobBzy/arcgis/rest/services/Parcels/FeatureServer/0";
  pagina.mockReset();
});
afterAll(() => {
  process.env = ENV;
});

const anillo = (x: number, y: number) => ({ rings: [[[x - 0.0001, y], [x + 0.0001, y], [x, y + 0.0001]]] });
const tres = () => [
  { attributes: { PARID: "5043431003", PARCEL_NUMBER: "50434310030000231" }, geometry: anillo(-80.039, 26.735) },
  { attributes: { PARID: "7443432125", PARCEL_NUMBER: "74434321250006140" }, geometry: anillo(-80.0535, 26.7135) },
  { attributes: { PARID: "74434309000001000", PARCEL_NUMBER: "74434309000001000" }, geometry: anillo(-80.06, 26.755) },
];

describe("conector de parcelas de Palm Beach", () => {
  it("usa la capa del condado aunque PALM_BEACH_PARCELS_URL apunte a la de la ciudad", async () => {
    pagina.mockResolvedValueOnce(tres());
    const r = await new PalmBeachParcelsConnector().sync({ cursor: null });
    expect(pagina.mock.calls[0][0]).toBe(CAPA_PALM_BEACH);
    expect(pagina.mock.calls[0][1]).toContain("PARCEL_NUMBER LIKE '50%'");
    expect(pagina.mock.calls[0][2]).toMatchObject({ offset: 0, cantidad: 3, orden: "PARCEL_NUMBER,OBJECTID" });
    expect(r.status).toBe("OK");
  });

  it("el cursor avanza por lo leido; a la ingesta van las del corredor, con el PCN como folio", async () => {
    pagina.mockResolvedValueOnce(tres());
    const r = await new PalmBeachParcelsConnector().sync({ cursor: null });
    const folios = (r.records as Array<{ attributes: { PARID: string } }>).map((x) => x.attributes.PARID);
    expect(folios).toEqual(["50434310030000231", "74434321250006140"]);
    expect(r.cursor).toMatchObject({ offset: 3, vueltas: 0 });
    expect(r.metrics).toMatchObject({ leidos: 3, fueraDelCorredor: 1, pedidos: 3 });
  });

  it("una fila por parcela: la capa repite la misma parcela", async () => {
    const [a, b] = tres();
    pagina.mockResolvedValueOnce([a, { ...a }, b]);
    const r = await new PalmBeachParcelsConnector().sync({ cursor: null });
    expect(r.records).toHaveLength(2);
    expect(r.cursor).toMatchObject({ offset: 3 });
    expect(r.metrics).toMatchObject({ leidos: 3, repetidas: 1, fueraDelCorredor: 0 });
  });

  it("al final del recorrido vuelve al principio, tambien en el borde de una pagina", async () => {
    const c = new PalmBeachParcelsConnector();
    pagina.mockResolvedValueOnce(tres());
    const primera = await c.sync({ cursor: null });
    pagina.mockResolvedValueOnce([]).mockResolvedValueOnce(tres().slice(0, 1));
    const segunda = await c.sync({ cursor: primera.cursor });
    expect(pagina.mock.calls.map((x) => x[2].offset)).toEqual([0, 3, 0]);
    expect(segunda.cursor).toMatchObject({ offset: 0, vueltas: 2 });
  });

  it("el estado de la integracion no mueve el recorrido: una sola parcela, sin geometria", async () => {
    pagina.mockResolvedValueOnce(tres().slice(0, 1));
    expect((await new PalmBeachParcelsConnector().getHealthStatus()).status).toBe("OK");
    expect(pagina.mock.calls[0][2]).toMatchObject({ offset: 0, cantidad: 1, geometria: false });
  });

  it("sin buybox.json legible, el sync falla con el motivo", async () => {
    process.env.BUYBOX_JSON = "/no/existe/buybox.json";
    const r = await new PalmBeachParcelsConnector().sync({ cursor: null });
    expect(r.status).toBe("ERROR");
    expect(r.message).toMatch(/no corridors/);
    expect(pagina).not.toHaveBeenCalled();
  });
});
