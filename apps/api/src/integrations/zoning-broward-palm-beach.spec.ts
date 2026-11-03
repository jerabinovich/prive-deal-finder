import {
  CAPA_ZONING_BROWARD,
  CAPA_ZONING_PALM_BEACH,
  cargarZoningPorUbicacion,
  ZONING_POR_FUENTE,
  zoningBroward,
  zoningPalmBeach,
} from "./zoning-broward-palm-beach";
import { zoningEnPunto } from "./zoning-miami-dade";

const filas = (...a: Record<string, unknown>[]) => a.map((attributes) => ({ attributes }));

describe("zoningBroward", () => {
  it("codigo de la ciudad; la descripcion solo si la capa la trae", async () => {
    const buscar = jest.fn().mockResolvedValue(filas({ ZONE_NAME: "RMM-25", ZONING: " " }));
    expect(await zoningBroward(-80.13, 26.12, buscar)).toBe("RMM-25");
    expect(buscar.mock.calls[0][0]).toBe(CAPA_ZONING_BROWARD);
    expect(buscar.mock.calls[0][1]).toMatchObject({ geometry: "-80.13,26.12", inSR: "4326", geometryType: "esriGeometryPoint" });
    buscar.mockResolvedValue(filas({ ZONE_NAME: "A-1", ZONING: "AGRICULTURAL ESTATE DISTRICT" }));
    expect(await zoningBroward(-80.4, 26.0, buscar)).toBe("A-1 (AGRICULTURAL ESTATE DISTRICT)");
  });
  it("superpuestos: todos, sin vacios ni repetidos", async () => {
    const buscar = jest.fn().mockResolvedValue(
      filas({ ZONE_NAME: "AOD", ZONING: " " }, { ZONE_NAME: " ", ZONING: " " }, { ZONE_NAME: "RM-20", ZONING: " " }, { ZONE_NAME: "AOD", ZONING: " " }),
    );
    expect(await zoningBroward(-80.08, 26.23, buscar)).toBe("AOD; RM-20");
  });
  it("sin poligono o solo vacios: null", async () => {
    expect(await zoningBroward(-80.1, 26.1, jest.fn().mockResolvedValue([]))).toBeNull();
    expect(await zoningBroward(-80.1, 26.1, jest.fn().mockResolvedValue(filas({ ZONE_NAME: " ", ZONING: " " })))).toBeNull();
  });
});

describe("zoningPalmBeach", () => {
  it("codigo y nombre del distrito; sin la marca (city) del municipio", async () => {
    const buscar = jest.fn().mockResolvedValue(filas({ FCODE: "R1D/DDRI (city)", FNAME: "SINGLE FAMILY RESIDENTIAL DISTRICT", ZONING_DESC: "RESIDENTIAL" }));
    expect(await zoningPalmBeach(-80.1, 26.35, buscar)).toBe("R1D/DDRI (SINGLE FAMILY RESIDENTIAL DISTRICT)");
    expect(buscar.mock.calls[0][0]).toBe(CAPA_ZONING_PALM_BEACH);
  });
  it("no incorporado: el codigo del condado tal cual", async () => {
    const buscar = jest.fn().mockResolvedValue(filas({ FCODE: "RH", FNAME: "MULTI-FAMILY RESIDENTIAL (HIGH DENSITY) DISTRICT" }));
    expect(await zoningPalmBeach(-80.1, 26.6, buscar)).toBe("RH (MULTI-FAMILY RESIDENTIAL (HIGH DENSITY) DISTRICT)");
  });
  it("sin poligono: null", async () => {
    expect(await zoningPalmBeach(-80.1, 26.6, jest.fn().mockResolvedValue([]))).toBeNull();
  });
});

describe("ZONING_POR_FUENTE", () => {
  it("los tres condados con zoning gratis; Monroe y Martin no", () => {
    expect(ZONING_POR_FUENTE["miami-dade-parcels"]).toBe(zoningEnPunto);
    expect(ZONING_POR_FUENTE["broward-parcels"]).toBe(zoningBroward);
    expect(ZONING_POR_FUENTE["palm-beach-parcels"]).toBe(zoningPalmBeach);
    expect(ZONING_POR_FUENTE["monroe-parcels"]).toBeUndefined();
    expect(ZONING_POR_FUENTE["martin-parcels"]).toBeUndefined();
  });
});

describe("cargarZoningPorUbicacion", () => {
  function prismaFalso(deals: unknown[]) {
    return { deal: { findMany: jest.fn().mockResolvedValue(deals), update: jest.fn().mockResolvedValue({}) } };
  }
  it("solo deals de la fuente con coordenadas y sin zoning; escribe solo con aplicar", async () => {
    const buscar = jest.fn().mockResolvedValue(filas({ ZONE_NAME: "B-3", ZONING: " " }));
    const prisma = prismaFalso([{ id: "d1", longitude: -80.14, latitude: 26.12 }]);
    const enSeco = await cargarZoningPorUbicacion(prisma as never, { fuente: "broward-parcels", aplicar: false, buscar });
    expect(prisma.deal.findMany.mock.calls[0][0].where).toEqual({
      source: "broward-parcels", latitude: { not: null }, longitude: { not: null }, zoning: null,
    });
    expect(prisma.deal.update).not.toHaveBeenCalled();
    expect(enSeco).toEqual({ fuente: "broward-parcels", deals: 1, conZoning: 1 });
    await cargarZoningPorUbicacion(prisma as never, { fuente: "broward-parcels", aplicar: true, buscar });
    expect(prisma.deal.update).toHaveBeenCalledWith({ where: { id: "d1" }, data: { zoning: "B-3" } });
  });
  it("con todos no filtra por zoning y respeta el limite", async () => {
    const prisma = prismaFalso([]);
    await cargarZoningPorUbicacion(prisma as never, { fuente: "palm-beach-parcels", aplicar: false, todos: true, limite: 5, buscar: jest.fn() });
    const consulta = prisma.deal.findMany.mock.calls[0][0];
    expect(consulta.where).toEqual({ source: "palm-beach-parcels", latitude: { not: null }, longitude: { not: null } });
    expect(consulta.take).toBe(5);
  });
  it("una fuente sin capa de zoning es un error, no una corrida vacia", async () => {
    await expect(cargarZoningPorUbicacion(prismaFalso([]) as never, { fuente: "monroe-parcels", aplicar: false })).rejects.toThrow(/monroe-parcels/);
  });
});
