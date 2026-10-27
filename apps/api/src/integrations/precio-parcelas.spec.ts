import { aplicarPrecio, planearPrecio, restaurarPrecio, resumenPrecio, valoresDeHoyPrecio } from "./precio-parcelas";

const parcela = {
  id: "p1", source: "palm-beach-parcels", parcelId: "1", address: "1 MAIN", city: "LANTANA", zip: "33462", propertyUseCode: "01",
  lotSizeSqft: 5000, buildingSizeSqft: 1000, yearBuilt: 1970, zoning: "RS", askingPrice: 205000, pricePerSqft: 205,
  latitude: 26.5, longitude: -80.05, dataCompletenessScore: 100,
};

describe("parcelas sin precio pedido (25-oct)", () => {
  it("la regla de hoy vacia el precio y deja la completitud de parcela", () => {
    expect(valoresDeHoyPrecio(parcela)).toEqual({ askingPrice: null, pricePerSqft: null, dataCompletenessScore: 100 });
    expect(valoresDeHoyPrecio({ ...parcela, lotSizeSqft: null }).dataCompletenessScore).toBe(90.9);
  });

  it("planear trae solo parcelas que cambian, y nunca un broker aunque se lo pida por fuente", async () => {
    const yaBien = { ...parcela, id: "ok", askingPrice: null, pricePerSqft: null };
    const completitudVieja = { ...parcela, id: "vieja", askingPrice: null, pricePerSqft: null, dataCompletenessScore: 76.9 };
    const broker = { ...parcela, id: "b", source: "broker_email - X" };
    const prisma = { deal: { findMany: jest.fn().mockResolvedValue([parcela, yaBien, completitudVieja, broker]) } };
    const cambios = await planearPrecio(prisma as never, ["palm-beach-parcels", "broker_email - X"]);
    expect(cambios.map((c) => c.id)).toEqual(["p1", "vieja"]);
    expect(cambios[0].antes).toEqual({ askingPrice: 205000, pricePerSqft: 205, dataCompletenessScore: 100 });
    expect(prisma.deal.findMany.mock.calls[0][0].where).toEqual({ source: { in: ["palm-beach-parcels", "broker_email - X"] } });
    expect(resumenPrecio(cambios)).toEqual({ cambios: 2, vacianPrecio: 1, porFuente: { "palm-beach-parcels": 2 }, completitud: { "0": 1, "+23": 1 } });
  });

  it("sin fuentes toma las de parcelas y mdpa", async () => {
    const prisma = { deal: { findMany: jest.fn().mockResolvedValue([]) } };
    await planearPrecio(prisma as never);
    expect(prisma.deal.findMany.mock.calls[0][0].where).toEqual({ OR: [{ source: { endsWith: "-parcels" } }, { source: "mdpa" }] });
  });

  const cambio = {
    id: "p1", source: "palm-beach-parcels",
    antes: { askingPrice: 205000, pricePerSqft: 205, dataCompletenessScore: 100 },
    despues: { askingPrice: null, pricePerSqft: null, dataCompletenessScore: 100 },
  };

  it("aplicar escribe solo si la fila sigue con el valor planeado, y la vigente manda", async () => {
    const prisma = { deal: { updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }) } };
    const salteados: string[] = [];
    const r = await aplicarPrecio(prisma as never, [cambio, { ...cambio, id: "p2" }, { ...cambio, id: "p3" }], {
      vigente: async (id) => (id === "p3" ? { ...cambio.despues, dataCompletenessScore: 90.9 } : cambio.despues),
      salteado: (id) => salteados.push(id),
    });
    expect(r).toEqual({ escritos: 1, saltados: 2 });
    expect(salteados).toEqual(["p2", "p3"]);
    expect(prisma.deal.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "p1", askingPrice: 205000, pricePerSqft: 205, dataCompletenessScore: 100 },
      data: { askingPrice: null, pricePerSqft: null, dataCompletenessScore: 100 },
    });
  });

  it("restaurar vuelve atras solo lo aplicado y no restaurado ya", async () => {
    const prisma = { deal: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const r = await restaurarPrecio(prisma as never, [cambio, { ...cambio, id: "p2" }, { ...cambio, id: "p3" }], ["p1", "p3"], { yaRestaurados: ["p3"] });
    expect(r).toEqual({ escritos: 1, saltados: 0 });
    expect(prisma.deal.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "p1", askingPrice: null, pricePerSqft: null, dataCompletenessScore: 100 },
      data: { askingPrice: 205000, pricePerSqft: 205, dataCompletenessScore: 100 },
    });
  });
});
