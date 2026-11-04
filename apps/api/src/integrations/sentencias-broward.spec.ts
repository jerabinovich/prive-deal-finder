import { FUENTE_SENTENCIA } from "../deals/distress-classification";
import { agregarDocumento, indiceVacio, leerDocumento } from "./registro-oficial-broward";
import { guardarSentencias, sentenciasDelIndice, ventanaDelRemate } from "./sentencias-broward";

// 1-nov-2026: la sentencia final del indice de Official Records de Broward como remate (decision 6 del estudio).
const doc = (inst: string, tipo: string, fecha: string, caso = "") =>
  `${inst}|${fecha}|x|101500|${tipo}|0.00|||O|||||2|0|V||E|${caso}|`;
function indice(lineas: string[]) {
  const ind = indiceVacio();
  for (const l of lineas) {
    const d = leerDocumento(l.split("|"));
    if (d) agregarDocumento(ind, d);
  }
  return ind;
}

describe("sentencias de Broward: lectura del indice", () => {
  it("solo FJ con caso; la mas reciente de cada caso; el caso sin guiones", () => {
    const s = sentenciasDelIndice(
      indice([
        doc("121170001", "FJ", "20261020", "CACE-26-016536"),
        doc("121178001", "FJ", "20261027", "CACE-26-016536"),
        doc("121178002", "FJX", "20261027", "CACE-26-000001"),
        doc("121178003", "LP", "20261027", "CACE-26-000002"),
        doc("121178004", "FJ", "20261027"),
      ]),
    );
    expect([...s.keys()]).toEqual(["CACE26016536"]);
    expect(s.get("CACE26016536")).toEqual({ caso: "CACE26016536", instrumento: "121178001", tipo: "FJ", fecha: "20261027" });
  });

  it("la ventana del remate es de 20 a 35 dias despues de la sentencia (s. 45.031)", () => {
    expect(ventanaDelRemate("20261029")).toEqual({ registro: "2026-10-29", desde: "2026-11-18", hasta: "2026-12-03" });
    expect(ventanaDelRemate("20261215")).toEqual({ registro: "2026-12-15", desde: "2027-01-04", hasta: "2027-01-19" });
  });
});

describe("sentencias de Broward: senal del deal", () => {
  function prismaFalso(existentes: Array<{ dealId: string; externalId: string }>) {
    const guardadas = new Map<string, string>();
    const p = {
      dealDistressSignal: {
        findMany: jest.fn(async ({ where }: any) => existentes.filter((e) => where.externalId.in.includes(e.externalId))),
        findUnique: jest.fn(async ({ where }: any) => {
          const k = JSON.stringify(where.dealId_source_externalId);
          return guardadas.has(k) ? { metadata: guardadas.get(k) } : null;
        }),
        upsert: jest.fn(async ({ where, create }: any) => {
          guardadas.set(JSON.stringify(where.dealId_source_externalId), create.metadata);
          return {};
        }),
      },
    };
    return p as any;
  }
  const sentencias = () =>
    sentenciasDelIndice(
      indice([doc("121178001", "FJ", "20261027", "CACE-26-016536"), doc("121178009", "FJ", "20261027", "CACE-26-099999")]),
    );

  it("entra solo para el caso que ya es senal de broward-foreclosure, con la ventana del remate", async () => {
    const p = prismaFalso([{ dealId: "deal-1", externalId: "CACE26016536" }]);
    const r = await guardarSentencias(p, sentencias());
    expect(r).toEqual({ enVentana: 2, conSenal: 1, nuevas: 1, dealIds: ["deal-1"] });
    expect(p.dealDistressSignal.findMany.mock.calls[0][0].where.source).toBe("broward-foreclosure");
    // 4-nov-2026: un caso cerrado por venta o liberacion (cierres-broward.ts) no vuelve por una sentencia.
    expect(p.dealDistressSignal.findMany.mock.calls[0][0].where.status).toBe("CONFIRMED");
    const { create } = p.dealDistressSignal.upsert.mock.calls[0][0];
    expect(create).toMatchObject({ dealId: "deal-1", source: FUENTE_SENTENCIA, externalId: "CACE26016536", status: "CONFIRMED", confidence: "HIGH" });
    expect(create.observedAt.toISOString()).toBe("2026-10-27T12:00:00.000Z");
    expect(JSON.parse(create.metadata)).toMatchObject({
      caseNumber: "CACE26016536", instrumento: "121178001", fechaRegistro: "2026-10-27", remateDesde: "2026-11-16", remateHasta: "2026-12-01",
    });
  });

  it("la misma sentencia otra vez no escribe ni recalcula", async () => {
    const p = prismaFalso([{ dealId: "deal-1", externalId: "CACE26016536" }]);
    await guardarSentencias(p, sentencias());
    const r = await guardarSentencias(p, sentencias());
    expect(r).toMatchObject({ conSenal: 1, nuevas: 0, dealIds: [] });
    expect(p.dealDistressSignal.upsert).toHaveBeenCalledTimes(1);
  });

  it("sin sentencias en la ventana no consulta la base", async () => {
    const p = prismaFalso([]);
    expect(await guardarSentencias(p, new Map())).toEqual({ enVentana: 0, conSenal: 0, nuevas: 0, dealIds: [] });
    expect(p.dealDistressSignal.findMany).not.toHaveBeenCalled();
  });
});
