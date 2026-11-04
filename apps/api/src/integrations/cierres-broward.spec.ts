import { agregarArchivo, indiceVacio } from "./registro-oficial-broward";
import { aAaaammdd, cierresDelIndice, FUENTE_CIERRE, guardarCierres, type SenalForeclosure } from "./cierres-broward";

// 4-nov-2026: el caso que termino antes del remate, leido del indice diario de Official Records de Broward.
const doc = (inst: string, tipo: string, fecha: string, monto = "0.00", folio = "", caso = "") =>
  `${inst}|${fecha}|x|101500|${tipo}|${monto}|||O||${folio}|||2|0|V||E|${caso}|`;
function indice(docs: string[], nombres: string[]) {
  const ind = indiceVacio();
  agregarArchivo(ind, "doc", docs.join("\n"));
  agregarArchivo(ind, "nme", nombres.join("\n"));
  return ind;
}
// CACE26015855, real: GNZ Funding contra Javiac Enterprises Corp, 6546 NW 24 Ct (folio 484124022810), demanda del 29-sep.
const JAVIAC: SenalForeclosure = {
  id: "s-1",
  dealId: "deal-margate",
  externalId: "CACE26015855",
  metadata: JSON.stringify({ caseNumber: "CACE26015855", defendantName: "JAVIAC ENTERPRISES CORP", filedDate: "09/29/2026" }),
  deal: { parcelId: "484124022810" },
};
const REAL = () =>
  indice(
    [doc("121171429", "RST", "20261026", "0.00", "", "CACE-26-015855"), doc("121172402", "D", "20261026", "425000.00", "484124022810")],
    ["121171429|GNZ FUNDING LLC|D|", "121171429|JAVIAC ENTERPRISES CORP|R|", "121172402|JAVIAC ENTERPRISES CORP|D|", "121172402|NORTH LAUDERDALE LLC|R|"],
  );

describe("cierres de Broward: lectura del indice", () => {
  it("el caso real de Margate: liberacion en el caso y venta del folio por el demandado", () => {
    const c = cierresDelIndice(REAL(), [JAVIAC]).get("s-1");
    expect(c).toEqual({
      caso: "CACE26015855",
      motivos: ["LIBERACION", "VENTA"],
      liberacion: { instrumento: "121171429", fecha: "2026-10-26" },
      venta: { instrumento: "121172402", fecha: "2026-10-26", monto: 425000, compradores: ["NORTH LAUDERDALE LLC"] },
    });
  });

  it("una transferencia nominal del demandado no es una venta: la hipoteca sigue", () => {
    const ind = indice([doc("1", "D", "20261026", "10.00", "484124022810")], ["1|JAVIAC ENTERPRISES CORP|D|", "1|JAVIAC,PEDRO|R|"]);
    expect(cierresDelIndice(ind, [JAVIAC]).size).toBe(0);
  });

  it("la escritura en la que el demandado compra, la de antes de la demanda o la de otro folio no cierran", () => {
    const ind = indice(
      [doc("1", "D", "20261026", "425000.00", "484124022810"), doc("2", "D", "20260920", "425000.00", "484124022810"), doc("3", "D", "20261026", "425000.00", "999999999999")],
      ["1|NORTH LAUDERDALE LLC|D|", "1|JAVIAC ENTERPRISES CORP|R|", "2|JAVIAC ENTERPRISES CORP|D|", "3|JAVIAC ENTERPRISES CORP|D|"],
    );
    expect(cierresDelIndice(ind, [JAVIAC]).size).toBe(0);
  });

  it("un RST de otro caso, o del caso pero sin el demandado entre las partes, no cierra", () => {
    const ind = indice(
      [doc("1", "RST", "20261026", "0.00", "", "CACE-26-099999"), doc("2", "RST", "20261026", "0.00", "", "CACE-26-015855")],
      ["1|GNZ FUNDING LLC|D|", "1|JAVIAC ENTERPRISES CORP|R|", "2|GNZ FUNDING LLC|D|", "2|OTRA PERSONA LLC|R|"],
    );
    expect(cierresDelIndice(ind, [JAVIAC]).size).toBe(0);
  });

  it("la liberacion sola cierra, y una persona del indice se compara por nombre completo", () => {
    const perez: SenalForeclosure = {
      id: "s-2",
      dealId: "deal-2",
      externalId: "CACE26017446",
      metadata: JSON.stringify({ defendantName: "Iliac Ballestero Perez", filedDate: "10/23/2026" }),
      deal: { parcelId: "514228331122" },
    };
    const ind = indice([doc("7", "RST", "20261102", "0.00", "", "CACE-26-017446")], ["7|PLANET HOME LENDING LLC|D|", "7|PEREZ,ILIAC BALLESTERO|R|"]);
    expect(cierresDelIndice(ind, [perez]).get("s-2")).toMatchObject({ motivos: ["LIBERACION"], liberacion: { fecha: "2026-11-02" } });
  });

  it("fechas del Clerk y en ISO", () => {
    expect(aAaaammdd("09/29/2026")).toBe("20260929");
    expect(aAaaammdd("2026-10-23T04:00:00.000Z")).toBe("20261023");
    expect(aAaaammdd("basura")).toBeNull();
  });
});

describe("cierres de Broward: senales", () => {
  function prismaFalso(senales: SenalForeclosure[]) {
    return {
      dealDistressSignal: {
        findMany: jest.fn(async () => senales),
        upsert: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
      },
    } as any;
  }

  it("guarda el cierre en CLEARED y pasa la senal del foreclosure a CLEARED", async () => {
    const p = prismaFalso([JAVIAC]);
    const r = await guardarCierres(p, REAL());
    expect(r).toEqual({ revisadas: 1, cerradas: 1, porLiberacion: 1, porVenta: 1, dealIds: ["deal-margate"] });
    expect(p.dealDistressSignal.findMany.mock.calls[0][0].where).toEqual({ source: "broward-foreclosure", status: "CONFIRMED" });
    const up = p.dealDistressSignal.upsert.mock.calls[0][0];
    expect(up.where).toEqual({ dealId_source_externalId: { dealId: "deal-margate", source: FUENTE_CIERRE, externalId: "CACE26015855" } });
    expect(up.create).toMatchObject({ source: "broward-cierre", status: "CLEARED", confidence: "HIGH" });
    expect(JSON.parse(up.create.metadata)).toMatchObject({ motivos: ["LIBERACION", "VENTA"], venta: { monto: 425000 } });
    expect(p.dealDistressSignal.update).toHaveBeenCalledWith({ where: { id: "s-1" }, data: { status: "CLEARED" } });
  });

  it("sin liberaciones ni escrituras en la ventana no lee la base", async () => {
    const p = prismaFalso([JAVIAC]);
    const ind = indice([doc("1", "FJ", "20261026", "0.00", "", "CACE-26-015855")], []);
    expect(await guardarCierres(p, ind)).toEqual({ revisadas: 0, cerradas: 0, porLiberacion: 0, porVenta: 0, dealIds: [] });
    expect(p.dealDistressSignal.findMany).not.toHaveBeenCalled();
  });

  it("una senal sin cierre no se toca", async () => {
    const p = prismaFalso([{ ...JAVIAC, deal: { parcelId: "111111111111" }, externalId: "CACE26000001" }]);
    expect((await guardarCierres(p, REAL())).cerradas).toBe(0);
    expect(p.dealDistressSignal.upsert).not.toHaveBeenCalled();
    expect(p.dealDistressSignal.update).not.toHaveBeenCalled();
  });
});
