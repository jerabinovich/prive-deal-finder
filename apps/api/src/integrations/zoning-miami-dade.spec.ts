import { CAPA_ZONING_CONDADO, CAPA_ZONING_MUNICIPAL, cargarZoningMiamiDade, textoZoning, zoningEnPunto } from "./zoning-miami-dade";

const municipal = (a: Record<string, unknown>) => [{ attributes: a }];

describe("textoZoning", () => {
  it("codigo y descripcion, sin el caracter roto del condado", () => {
    expect(textoZoning("RU-1", "Single-family Residential District 7,500 ft2ÿnet")).toBe("RU-1 (Single-family Residential District 7,500 ft2 net)");
    expect(textoZoning("T6-80-O", "URBAN CORE ZONE")).toBe("T6-80-O (URBAN CORE ZONE)");
    expect(textoZoning("T3-O", null)).toBe("T3-O");
  });
  it("NONE o vacio no es zoning", () => {
    expect(textoZoning("NONE", "NONE")).toBeNull();
    expect(textoZoning(" ", "algo")).toBeNull();
  });
});

describe("zoningEnPunto", () => {
  it("municipio con zoning: la capa municipal y no consulta la del condado", async () => {
    const buscar = jest.fn().mockResolvedValue(municipal({ ZONE: "T6-12-O", ZONEDESC: "URBAN CORE ZONE", MUNICNAME: "MIAMI" }));
    expect(await zoningEnPunto(-80.2, 25.77, buscar)).toBe("T6-12-O (URBAN CORE ZONE)");
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(buscar.mock.calls[0][0]).toBe(CAPA_ZONING_MUNICIPAL);
    expect(buscar.mock.calls[0][1]).toMatchObject({ geometry: "-80.2,25.77", inSR: "4326", geometryType: "esriGeometryPoint" });
  });
  it("no incorporado (NONE en la municipal): la capa del condado", async () => {
    const buscar = jest.fn()
      .mockResolvedValueOnce(municipal({ ZONE: "NONE", ZONEDESC: "NONE", MUNICNAME: "UNINCORPORATED" }))
      .mockResolvedValueOnce([{ attributes: { ZONE: "RU-2", ZONE_DESC: "Two-family Residential District, 7,500 ft2 net" } }]);
    expect(await zoningEnPunto(-80.2, 25.85, buscar)).toBe("RU-2 (Two-family Residential District, 7,500 ft2 net)");
    expect(buscar.mock.calls[1][0]).toBe(CAPA_ZONING_CONDADO);
  });
  it("sin poligono en ninguna: null", async () => {
    const buscar = jest.fn().mockResolvedValue([]);
    expect(await zoningEnPunto(-80.2, 25.85, buscar)).toBeNull();
  });
});

describe("cargarZoningMiamiDade", () => {
  function prismaFalso(deals: unknown[]) {
    return { deal: { findMany: jest.fn().mockResolvedValue(deals), update: jest.fn().mockResolvedValue({}) } };
  }
  it("solo deals de Miami-Dade con coordenadas y sin zoning; escribe solo con aplicar", async () => {
    const buscar = jest.fn().mockResolvedValue(municipal({ ZONE: "T5-O", ZONEDESC: "URBAN CENTER ZONE" }));
    const prisma = prismaFalso([{ id: "d1", longitude: -80.2, latitude: 25.77 }]);
    const enSeco = await cargarZoningMiamiDade(prisma as never, { aplicar: false, buscar });
    expect(prisma.deal.findMany.mock.calls[0][0].where).toEqual({
      source: "miami-dade-parcels", latitude: { not: null }, longitude: { not: null }, zoning: null,
    });
    expect(prisma.deal.update).not.toHaveBeenCalled();
    expect(enSeco).toEqual({ deals: 1, conZoning: 1 });
    await cargarZoningMiamiDade(prisma as never, { aplicar: true, buscar });
    expect(prisma.deal.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { zoning: "T5-O (URBAN CENTER ZONE)" } });
  });
});
