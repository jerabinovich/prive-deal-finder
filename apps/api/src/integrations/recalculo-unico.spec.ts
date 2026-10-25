import * as R from "./recalculo-unico";
import { aplicar, planear, restaurar, valoresDeHoy } from "./recalculo-unico";

const base = {
  assetType: "MULTIFAMILY 10 UNITS PLUS", propertyUseCode: "0300", mailingAddress: null, city: "POMPANO BEACH",
  municipality: "POMPANO BEACH", state: "FL", yearBuilt: 1975, lotSizeSqft: 12000, source: "broward-parcels",
  isNoise: false, noiseReason: null, owners: [{ owner: { name: "SEAVIEW HOLDINGS LLC" } }],
};

describe("recalculo unico de scores (25-oct)", () => {
  it("planear devuelve solo los deals cuyo score guardado no coincide con la formula de hoy, con la etapa guardada", async () => {
    const bien = { ...base, id: "ok", distressStage: "NONE", score: 0 };
    bien.score = valoresDeHoy(bien as never).score as number;
    const viejo = { ...base, id: "viejo", distressStage: "NONE", score: 1 };
    const gob = { ...base, id: "gob", propertyUseCode: "Vacant Governmental (DOR 80)", distressStage: "GOVERNMENT_LAND", score: -1 };
    const prisma = { deal: { findMany: jest.fn().mockResolvedValue([bien, viejo, gob]) } };
    const cambios = await planear(prisma as never);
    expect(cambios.map((c) => c.id)).toEqual(["viejo", "gob"]);
    expect(cambios[0].antes.score).toBe(1);
    expect(cambios[0].despues.score).toBe(valoresDeHoy(viejo as never).score);
    expect(cambios[1].despues.score).toBe(valoresDeHoy(gob as never).score);
    expect(prisma.deal.findMany.mock.calls[0][0].where).toEqual({ OR: [{ source: { endsWith: "-parcels" } }, { source: "mdpa" }] });
  });

  it("planear con fuentes filtra por esas fuentes", async () => {
    const prisma = { deal: { findMany: jest.fn().mockResolvedValue([]) } };
    await planear(prisma as never, ["martin-parcels"]);
    expect(prisma.deal.findMany.mock.calls[0][0].where).toEqual({ source: { in: ["martin-parcels"] } });
  });

  const cambio = {
    id: "d1",
    antes: { score: 31, isNoise: false, noiseReason: null },
    despues: { score: 41, isNoise: false, noiseReason: null },
  };

  it("aplicar escribe el valor nuevo solo si el guardado sigue siendo el planeado, y cuenta lo salteado", async () => {
    const prisma = { deal: { updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }) } };
    expect(await aplicar(prisma as never, [cambio, { ...cambio, id: "d2" }])).toEqual({ escritos: 1, saltados: 1 });
    expect(prisma.deal.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "d1", score: 31, isNoise: false, noiseReason: null },
      data: { score: 41, isNoise: false, noiseReason: null },
    });
  });

  it("restaurar vuelve al valor anterior solo si sigue el que escribio aplicar", async () => {
    const prisma = { deal: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    expect(await (restaurar as unknown as (p: unknown, cs: unknown[], a?: string[]) => Promise<unknown>)(prisma, [cambio], ["d1"])).toEqual({ escritos: 1, saltados: 0 });
    expect(prisma.deal.updateMany.mock.calls[0][0]).toEqual({
      where: { id: "d1", score: 41, isNoise: false, noiseReason: null },
      data: { score: 31, isNoise: false, noiseReason: null },
    });
  });
});

describe("revision de Codex del PR 22", () => {
  const c = (id: string) => ({ id, antes: { score: 31, isNoise: false, noiseReason: null }, despues: { score: 41, isNoise: false, noiseReason: null } });
  // Tipado explicito para que el mismo test corra contra la version sin estos parametros (prueba en rojo).
  const leer = (R as unknown as { leerArgumentos?: (a: string[]) => unknown }).leerArgumentos;
  const restaurarCon = restaurar as unknown as (p: unknown, cs: unknown[], aplicados?: string[]) => Promise<unknown>;

  it("--fuente, --respaldo o --restaurar sin valor es un error, nunca correr sobre todas las fuentes", () => {
    expect(typeof leer).toBe("function");
    expect(() => leer!(["--aplicar", "--respaldo", "r.json", "--fuente"])).toThrow(/--fuente/);
    expect(() => leer!(["--aplicar", "--respaldo"])).toThrow(/--respaldo/);
    expect(() => leer!(["--fuente", "--aplicar"])).toThrow(/--fuente/);
    expect(leer!(["--aplicar", "--respaldo", "r.json", "--fuente", "a", "--fuente", "b"])).toEqual({
      aplicar: true, respaldo: "r.json", restaurar: undefined, fuentes: ["a", "b"],
    });
  });

  it("aplicar avisa cada fila que escribio de verdad", async () => {
    const prisma = { deal: { updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }) } };
    const escritos: string[] = [];
    await (aplicar as unknown as (p: unknown, cs: unknown[], reg?: { antes?: (id: string) => void; salteado?: (id: string) => void }) => Promise<unknown>)(
      prisma, [c("d1"), c("d2")], { antes: (id) => escritos.push(id), salteado: (id) => escritos.splice(escritos.indexOf(id), 1) });
    expect(escritos).toEqual(["d1"]);
  });

  it("restaurar solo toca las filas que el aplicado escribio", async () => {
    const prisma = { deal: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    await restaurarCon(prisma, [c("d1"), c("d2")], ["d1"]);
    expect(prisma.deal.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.deal.updateMany.mock.calls[0][0].where.id).toBe("d1");
  });
});

describe("segunda revision de Codex del PR 22", () => {
  const c = (id: string) => ({ id, antes: { score: 31, isNoise: false, noiseReason: null }, despues: { score: 41, isNoise: false, noiseReason: null } });
  type Registro = { antes?: (id: string) => void; salteado?: (id: string) => void };
  const aplicarCon = aplicar as unknown as (p: unknown, cs: unknown[], reg?: Registro) => Promise<unknown>;
  const leer = (R as unknown as { leerArgumentos: (a: string[]) => unknown }).leerArgumentos;
  const aRestaurar = (R as unknown as { filasARestaurar?: (lineas: string[]) => string[] }).filasARestaurar;

  it("aplicar anota cada fila ANTES de escribirla y marca las salteadas", async () => {
    const orden: string[] = [];
    const prisma = { deal: { updateMany: jest.fn(async ({ where }: { where: { id: string } }) => {
      orden.push(`db ${where.id}`);
      return { count: where.id === "d1" ? 1 : 0 };
    }) } };
    await aplicarCon(prisma, [c("d1"), c("d2")], { antes: (id) => orden.push(`intento ${id}`), salteado: (id) => orden.push(`salteado ${id}`) });
    expect(orden).toEqual(["intento d1", "db d1", "intento d2", "db d2", "salteado d2"]);
  });

  it("del registro se restauran los intentos menos los salteados", () => {
    expect(typeof aRestaurar).toBe("function");
    expect(aRestaurar!(["intento d1", "intento d2", "salteado d2", "intento d3", ""])).toEqual(["d1", "d3"]);
  });

  it("una opcion desconocida es un error (antes --fuent se ignoraba y tomaba todas las fuentes)", () => {
    expect(() => leer(["--aplicar", "--respaldo", "r.json", "--fuent", "martin-parcels"])).toThrow(/--fuent/);
  });
});
