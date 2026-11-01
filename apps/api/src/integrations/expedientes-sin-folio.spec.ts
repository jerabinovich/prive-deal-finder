import {
  actualizarSinFolio,
  CLAVE_SIN_FOLIO,
  DIAS_A_LA_VISTA,
  DIAS_DE_REINTENTO,
  guardarSinFolio,
  leerSinFolio,
  MARCA_REINTENTO,
  MAX_SIN_FOLIO,
  paraReintentar,
  registroLimpio,
  type ExpedienteSinFolio,
} from "./expedientes-sin-folio";

// 31-oct-2026: la lista de expedientes de Broward sin folio (Integration.meta.expedientesSinFolio).
const hoy = new Date("2026-11-02T13:00:00Z");
const exp = (caso: string, desde: string, ultimoEstado: string, extra: Partial<ExpedienteSinFolio> = {}): ExpedienteSinFolio => ({
  caso,
  desde,
  intentos: 1,
  ultimoEstado,
  registro: { caseNumber: caso, defendantName: "Juan Perez", resolucionFolio: { estado: "SIN_COINCIDENCIA" } },
  ...extra,
});

describe("expedientes sin folio: que se reintenta", () => {
  it("solo los que pueden resolver: sin lis pendens todavia, error del FTP o sin intento", () => {
    const lista = [
      exp("A", "2026-10-30", "SIN_LIS_PENDENS"),
      exp("B", "2026-10-30", "ERROR"),
      exp("C", "2026-10-30", "SIN_INTENTO"),
      exp("D", "2026-10-30", "SIN_HIPOTECA_ENLAZADA"),
      exp("E", "2026-10-30", "DEUDOR_NO_COINCIDE"),
      exp("F", "2026-10-30", "SIN_ESCRITURA"),
    ];
    expect(paraReintentar(lista, hoy).map((r) => r.caseNumber)).toEqual(["A", "B", "C"]);
  });
  it(`hasta ${DIAS_DE_REINTENTO} dias desde que entro`, () => {
    const lista = [exp("A", "2026-10-19", "SIN_LIS_PENDENS"), exp("B", "2026-10-18", "SIN_LIS_PENDENS")];
    expect(paraReintentar(lista, hoy).map((r) => r.caseNumber)).toEqual(["A"]);
  });
  it("vuelve marcado para no repetir el nombre, con su resolucion por nombre", () => {
    const [r] = paraReintentar([exp("A", "2026-10-30", "SIN_LIS_PENDENS")], hoy);
    expect(r[MARCA_REINTENTO]).toBe(true);
    expect(r.resolucionFolio).toEqual({ estado: "SIN_COINCIDENCIA" });
  });
});

describe("expedientes sin folio: la lista despues de la corrida", () => {
  it("suma el nuevo sin folio, saca el resuelto y cuenta los dos", () => {
    const anteriores = [exp("CACE26000001", "2026-10-30", "SIN_LIS_PENDENS")];
    const registros = [
      { caseNumber: "CACE26000001", parcelIds: ["504206200430"], registroOficial: { estado: "CADENA" } },
      { caseNumber: "CACE-26-000002", defendantName: "Ana Gomez", registroOficial: { estado: "SIN_LIS_PENDENS" }, [MARCA_REINTENTO]: true },
      { caseNumber: "CACE26000003", parcelIds: ["504205150170"] },
      { defendantName: "sin caso" },
    ];
    const r = actualizarSinFolio(anteriores, registros, hoy);
    expect(r.resueltos).toBe(1);
    expect(r.nuevos).toBe(1);
    expect(r.lista.map((e) => e.caso)).toEqual(["CACE26000002"]);
    expect(r.lista[0]).toMatchObject({ desde: "2026-11-02", intentos: 1, ultimoEstado: "SIN_LIS_PENDENS" });
    expect(r.lista[0].registro).toEqual({ caseNumber: "CACE-26-000002", defendantName: "Ana Gomez" });
  });
  it("un reintento que sigue sin folio conserva la fecha de entrada y suma un intento", () => {
    const anteriores = [exp("CACE26000001", "2026-10-28", "SIN_LIS_PENDENS", { intentos: 2 })];
    const r = actualizarSinFolio(anteriores, [{ caseNumber: "CACE26000001", registroOficial: { estado: "SIN_ESCRITURA" } }], hoy);
    expect(r.lista[0]).toMatchObject({ desde: "2026-10-28", intentos: 3, ultimoEstado: "SIN_ESCRITURA" });
    expect(r.nuevos).toBe(0);
  });
  it("los que hoy no se reintentaron quedan como estaban, y los vencidos salen", () => {
    const anteriores = [exp("A", "2026-10-25", "DEUDOR_NO_COINCIDE"), exp("B", "2026-10-01", "SIN_ESCRITURA")];
    const r = actualizarSinFolio(anteriores, [], hoy);
    expect(r.lista.map((e) => e.caso)).toEqual(["A"]);
    expect(r.vencidos).toBe(1);
    expect(DIAS_A_LA_VISTA).toBe(30);
  });
  it(`como mucho ${MAX_SIN_FOLIO}, los mas recientes`, () => {
    const anteriores = Array.from({ length: MAX_SIN_FOLIO + 5 }, (_, i) =>
      exp(`C${i}`, i < 5 ? "2026-10-10" : "2026-10-31", "SIN_ESCRITURA"),
    );
    const r = actualizarSinFolio(anteriores, [], hoy);
    expect(r.lista.length).toBe(MAX_SIN_FOLIO);
    expect(r.lista.every((e) => e.desde === "2026-10-31")).toBe(true);
    expect(r.vencidos).toBe(5);
  });
  it("el registro guardado no lleva lo que agrega cada corrida", () => {
    expect(
      registroLimpio({ caseNumber: "X", parcelId: "1", parcelIds: ["1"], registroOficial: {}, subdivision: "S", [MARCA_REINTENTO]: true }),
    ).toEqual({ caseNumber: "X" });
  });
});

describe("expedientes sin folio: Integration.meta", () => {
  function prisma(meta?: Record<string, unknown>) {
    const filas: Record<string, string> = meta ? { "broward-foreclosure": JSON.stringify(meta) } : {};
    return {
      filas,
      integration: {
        findUnique: jest.fn(async ({ where }: any) => (where.source in filas ? { meta: filas[where.source] } : null)),
        upsert: jest.fn(async ({ where, update, create }: any) => {
          filas[where.source] = update?.meta ?? create?.meta;
          return {};
        }),
      },
    } as any;
  }
  it("guarda la lista sin pisar el estado del conector ni el cursor", async () => {
    const p = prisma({ estadoConector: { ultimaFechaCompleta: "2026-10-29" }, cursorParcelas: { pos: 1 } });
    await guardarSinFolio(p, "broward-foreclosure", [exp("A", "2026-10-30", "SIN_LIS_PENDENS")]);
    const meta = JSON.parse(p.filas["broward-foreclosure"]);
    expect(meta.estadoConector).toEqual({ ultimaFechaCompleta: "2026-10-29" });
    expect(meta.cursorParcelas).toEqual({ pos: 1 });
    expect(meta[CLAVE_SIN_FOLIO]).toHaveLength(1);
    expect(await leerSinFolio(p, "broward-foreclosure")).toHaveLength(1);
  });
  it("sin fila, o con basura, devuelve una lista vacia", async () => {
    expect(await leerSinFolio(prisma(), "broward-foreclosure")).toEqual([]);
    expect(await leerSinFolio(prisma({ [CLAVE_SIN_FOLIO]: [{ caso: 1 }, "x", null] }), "broward-foreclosure")).toEqual([]);
  });
});
