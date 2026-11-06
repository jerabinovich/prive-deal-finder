import {
  calcularPatrimonio,
  cargarIndicePatrimonio,
  carteraDelDueno,
  claseAcreedor,
  demandanteDeSenal,
  estimarGrupo,
  estimarPatrimonio,
  gruposPorCaso,
  hipotecasDeLaSenal,
  montoEscritura,
  montoHipoteca,
  saldoAmortizado,
  type ArchivoLocal,
  type Objetivo,
} from "./patrimonio-broward";
import { computeTriageScore, puntosPatrimonio } from "../scoring/score";

const HOY = new Date("2026-11-06T12:00:00Z");
const ymd = (f: string) => `${f.slice(6, 10)}${f.slice(0, 2)}${f.slice(3, 5)}`;
const doc = (inst: string, fecha: string, tipo: string, monto: number, folio = "", sello = 0, intang = 0, caso = "", hora = "101500") =>
  `${inst}|${ymd(fecha)}|${fecha}|${hora}|${tipo}|${monto.toFixed(2)}|||O||${folio}|${sello || ""}|${intang || ""}|1|0|V||E|${caso}|`;
const nme = (inst: string, nombre: string, lado: string) => `${inst}|${nombre}|${lado}|1|`;
const lnk = (inst: string, tipo: string, destino: string, tipoDestino: string) => `${inst}|||O|${tipo}|${destino}|1|1|O|${tipoDestino}|${destino}|`;

function indiceFalso(archivos: Record<string, string[]>) {
  const lista: ArchivoLocal[] = Object.keys(archivos).map((ruta) => {
    const m = /CY(\d{4})(doc|nme|lnk)/.exec(ruta) as RegExpExecArray;
    return { ruta, tipo: m[2] as ArchivoLocal["tipo"], anio: Number(m[1]) };
  });
  const lector = async (ruta: string, porLinea: (l: string) => void) => archivos[ruta].forEach(porLinea);
  return { lista, lector };
}

describe("patrimonio de Broward: piezas", () => {
  it("monto de hipoteca y escritura por los impuestos cuando el indice trae 0", () => {
    expect(montoHipoteca({ monto: 896000, sello: 0, intangible: 0 })).toBe(896000);
    expect(montoHipoteca({ monto: 0, sello: 0, intangible: 1792 })).toBe(896000);
    expect(montoHipoteca({ monto: 0, sello: 13650, intangible: 0 })).toBe(3900000);
    expect(montoEscritura({ monto: 0, sello: 4200 })).toBe(600000);
  });

  it("saldo amortizado a 30 anios con la tasa del anio (Hallandale: 554.766 de ago-2023)", () => {
    const s = saldoAmortizado(554766, "08/28/2023", HOY);
    expect(s).toBeGreaterThan(530000);
    expect(s).toBeLessThan(540000);
    expect(saldoAmortizado(100000, "01/01/1990", HOY)).toBe(0);
  });

  it("clase del acreedor por el demandante", () => {
    expect(claseAcreedor("GNZ FUNDING LLC")).toBe("PRIVADO");
    expect(claseAcreedor("U S Bank Trust Company National Association")).toBe("BANCO");
    expect(claseAcreedor("Community Credit Union of Florida")).toBe("BANCO");
    expect(claseAcreedor("CITY NATIONAL BANK OF FLORIDA")).toBe("BANCO");
    expect(claseAcreedor("Planet Home Lending LLC")).toBe("BANCO");
    expect(claseAcreedor("Sunrise Lakes Condominium Association, Inc.")).toBe("CONSORCIO");
    expect(claseAcreedor("City of Dania Beach")).toBe("MUNICIPIO");
    expect(claseAcreedor("Morgan B. Lea, et al")).toBe("PRIVADO");
    expect(claseAcreedor(null)).toBe("SIN_JUICIO");
  });

  it("el demandante sale de la caratula de la senal", () => {
    const meta = JSON.stringify({ caption: "CITY NATIONAL BANK OF FLORIDA         Plaintiff vs.   NARANG PLAZA POMPANO, INC., et al         Defendant" });
    expect(demandanteDeSenal(meta)).toBe("CITY NATIONAL BANK OF FLORIDA");
    expect(demandanteDeSenal("no es json")).toBeNull();
  });

  it("puntos del patrimonio: tope, piso, peso de la confianza", () => {
    expect(puntosPatrimonio(0.5, "ALTA")).toBe(10);
    expect(puntosPatrimonio(0.25, "ALTA")).toBe(6);
    expect(puntosPatrimonio(0.05, "ALTA")).toBe(2);
    expect(puntosPatrimonio(-0.3, "ALTA")).toBe(-5);
    expect(puntosPatrimonio(0.5, "MEDIA")).toBe(6);
    expect(puntosPatrimonio(-0.3, "MEDIA")).toBe(-3);
    expect(puntosPatrimonio(0.9, "BAJA")).toBe(0);
    expect(puntosPatrimonio(null, "ALTA")).toBe(0);
  });

  it("el score de triage suma o resta el patrimonio y lo explica", () => {
    const base = { assetType: "Stores, one story (DOR 11)", ownerNames: ["NARANG PLAZA POMPANO INC"], source: "broward-parcels", distressStage: "PRE_FORECLOSURE" };
    const sin = computeTriageScore(base);
    const con = computeTriageScore({ ...base, equityRatio: 0.3, equityConfidence: "ALTA" });
    const bajo = computeTriageScore({ ...base, equityRatio: -0.5, equityConfidence: "ALTA" });
    const baja = computeTriageScore({ ...base, equityRatio: 0.9, equityConfidence: "BAJA" });
    expect(con.score - sin.score).toBe(6);
    expect(bajo.score - sin.score).toBe(-5);
    expect(baja.score).toBe(sin.score);
    expect(con.reasons.join(" ")).toMatch(/patrimonio estimado 30% de la tasacion, confianza ALTA \(\+6\)/);
  });
});

describe("patrimonio de Broward: la cuenta sobre el indice", () => {
  const FOLIO = "494212040070";
  const objetivo = (o: Partial<Objetivo> = {}): Objetivo => ({
    dealId: "d1", folio: FOLIO, duenos: ["NARANG PLAZA POMPANO INC"], casos: [], demandante: "CITY NATIONAL BANK OF FLORIDA", ...o,
  });

  it("COMPRA: la hipoteca pegada a la escritura del folio, sin cancelar: ALTA", async () => {
    const { lista, lector } = indiceFalso({
      "CY2021doc-rec.txt": [
        doc("117300100", "04/19/2021", "D", 600000, FOLIO, 4200),
        doc("117300101", "04/19/2021", "M", 0, "", 0, 1100), // 550.000 por el intangible
        doc("117300102", "04/19/2021", "D", 10, "999999999999"), // otra cosa del mismo dia
      ],
      "CY2021nme-rec.txt": [
        nme("117300100", "EAGLE'S LANDING PROPERTIES LLC", "D"),
        nme("117300100", "NARANG PLAZA POMPANO INC", "R"),
        nme("117300101", "NARANG PLAZA POMPANO INC", "D"),
        nme("117300101", "SOME BANK NA", "R"),
      ],
      "CY2021lnk-rec.txt": [],
    });
    const obj = objetivo();
    const ind = await cargarIndicePatrimonio([obj], lista, lector);
    const e = estimarPatrimonio(0, obj, ind, 1000000, HOY);
    expect(e.compra).toEqual({ fecha: "04/19/2021", precio: 600000, instrumento: "117300100" });
    expect(e.hipotecas).toHaveLength(1);
    expect(e.hipotecas[0]).toMatchObject({ origen: "COMPRA", principal: 550000, saldoAlto: 550000, acreedores: ["SOME BANK NA"], cancelada: false });
    expect(e.deudaAlta).toBe(550000);
    expect(e.patrimonioConservador).toBe(450000);
    expect(e.ratio).toBe(0.45);
    expect(e.confianza).toBe("ALTA");
    expect(e.acreedor).toBe("BANCO");
  });

  it("CASO: la hipoteca del lis pendens; con dos parcelas, la otra del dueno no se asigna: MEDIA", async () => {
    const { lista, lector } = indiceFalso({
      "CY2021doc-rec.txt": [
        doc("117300100", "04/19/2021", "D", 600000, FOLIO, 4200),
        doc("117300200", "05/05/2021", "D", 1140000, "484235001430", 7980),
      ],
      "CY2022doc-rec.txt": [
        doc("118000001", "01/27/2022", "M", 896000),
        doc("118000050", "03/02/2022", "M", 1000000),
        doc("121000000", "09/15/2022", "LP", 0, "", 0, 0, "CACE-26-014898"),
      ],
      "CY2021nme-rec.txt": [
        nme("117300100", "NARANG PLAZA POMPANO INC", "R"),
        nme("117300200", "NARANG PLAZA POMPANO INC", "R"),
      ],
      "CY2022nme-rec.txt": [
        nme("118000001", "NARANG PLAZA POMPANO INC", "D"),
        nme("118000001", "CITY NATIONAL BANK OF FLORIDA", "R"),
        nme("118000050", "NARANG PLAZA POMPANO, INC.", "D"),
        nme("121000000", "CITY NATIONAL BANK OF FLORIDA", "D"),
      ],
      "CY2021lnk-rec.txt": [],
      "CY2022lnk-rec.txt": [lnk("121000000", "LP", "118000001", "M")],
    });
    const obj = objetivo({ casos: ["CACE26014898"] });
    const ind = await cargarIndicePatrimonio([obj], lista, lector);
    expect(carteraDelDueno(0, ind)).toEqual(["484235001430", FOLIO]);
    const e = estimarPatrimonio(0, obj, ind, 830000, HOY);
    expect(e.hipotecas.map((h) => [h.instrumento, h.origen])).toEqual([["118000001", "CASO"]]);
    expect(e.noAsignadas).toBe(1);
    expect(e.confianza).toBe("MEDIA");
    expect(e.patrimonioConservador).toBe(830000 - 896000);
    expect(e.ratio).toBeLessThan(0);
  });

  it("una hipoteca cancelada por una satisfaccion no cuenta; una sola parcela y sin deuda viva: libre", async () => {
    const { lista, lector } = indiceFalso({
      "CY2015doc-rec.txt": [doc("113000000", "06/01/2015", "D", 300000, FOLIO, 2100), doc("113000001", "06/01/2015", "M", 240000)],
      "CY2015nme-rec.txt": [nme("113000000", "PEREZ,ILIAC BALLESTERO", "R"), nme("113000001", "PEREZ,ILIAC BALLESTERO", "D")],
      "CY2015lnk-rec.txt": [],
      "CY2024lnk-rec.txt": [lnk("120000000", "RST", "113000001", "M")],
    });
    const obj = objetivo({ duenos: ["PEREZ,ILIAC BALLESTERO"], demandante: "Sunrise Lakes Condominium Association, Inc." });
    const ind = await cargarIndicePatrimonio([obj], lista, lector);
    const e = estimarPatrimonio(0, obj, ind, 500000, HOY);
    expect(e.hipotecas[0]).toMatchObject({ cancelada: true, saldoAlto: 0 });
    expect(e.deudaAlta).toBe(0);
    expect(e.ratio).toBe(1);
    expect(e.confianza).toBe("ALTA");
    expect(e.acreedor).toBe("CONSORCIO");
  });

  it("sin escritura del dueno en el registro (compra de 2026): BAJA, y no se le cargan hipotecas sueltas", async () => {
    const { lista, lector } = indiceFalso({
      "CY2013doc-rec.txt": [doc("111000000", "10/10/2013", "D", 101000, "484124022810", 707)],
      "CY2013nme-rec.txt": [nme("111000000", "SHIRLEY,ANDREW", "R")],
      "CY2019doc-rec.txt": [doc("116000000", "02/02/2019", "M", 200000)],
      "CY2019nme-rec.txt": [nme("116000000", "JAVIAC ENTERPRISES CORP", "D")],
    });
    const obj = objetivo({ folio: "484124022810", duenos: ["JAVIAC ENTERPRISES CORP"], demandante: "GNZ FUNDING LLC" });
    const ind = await cargarIndicePatrimonio([obj], lista, lector);
    const e = estimarPatrimonio(0, obj, ind, 431500, HOY);
    expect(e.compra).toBeNull();
    expect(e.hipotecas).toHaveLength(0);
    expect(e.confianza).toBe("BAJA");
    expect(e.acreedor).toBe("PRIVADO");
    expect(puntosPatrimonio(e.ratio, e.confianza)).toBe(0);
  });

  it("sin tasacion: SIN_DATOS y sin ratio", async () => {
    const { lista, lector } = indiceFalso({ "CY2021doc-rec.txt": [], "CY2021nme-rec.txt": [] });
    const obj = objetivo();
    const ind = await cargarIndicePatrimonio([obj], lista, lector);
    const e = estimarPatrimonio(0, obj, ind, null, HOY);
    expect(e.confianza).toBe("SIN_DATOS");
    expect(e.ratio).toBeNull();
  });

  it("un homonimo con otro segundo nombre no es el dueno", async () => {
    const { lista, lector } = indiceFalso({
      "CY2021doc-rec.txt": [doc("117300100", "04/19/2021", "D", 600000, FOLIO, 4200), doc("117300101", "04/19/2021", "M", 500000)],
      "CY2021nme-rec.txt": [nme("117300100", "MARTINEZ,ERNESTO JOSE", "R"), nme("117300101", "MARTINEZ,ERNESTO JOSE", "D")],
    });
    const obj = objetivo({ duenos: ["MARTINEZ,ERNESTO LUIS"] });
    const ind = await cargarIndicePatrimonio([obj], lista, lector);
    const e = estimarPatrimonio(0, obj, ind, 700000, HOY);
    expect(e.compra).toBeNull();
    expect(e.hipotecas).toHaveLength(0);
  });
});

describe("patrimonio de Broward: grupos por juicio", () => {
  const A = "494212040070";
  const B = "484235001430";
  const base = (dealId: string, folio: string, o: Partial<Objetivo> = {}): Objetivo => ({
    dealId, folio, duenos: ["NARANG PLAZA POMPANO INC"], casos: ["CACE26014898"], demandante: "CITY NATIONAL BANK OF FLORIDA", ...o,
  });

  it("los deals que comparten un caso son un grupo", () => {
    const g = gruposPorCaso([base("a", A), base("b", B, { casos: ["CACE-26-014898"] }), base("c", "X", { casos: ["CACE26000001"] }), base("d", "Y", { casos: [] })]);
    expect(g.map((x) => x.sort())).toEqual([[0, 1], [2], [3]]);
  });

  it("el grupo suma tasacion y deuda; las hipotecas del dueno se asignan si no tiene otras parcelas: MEDIA", async () => {
    const { lista, lector } = indiceFalso({
      "CY2017doc-rec.txt": [doc("114000000", "05/05/2017", "D", 1140000, B, 7980)],
      "CY2017nme-rec.txt": [nme("114000000", "NARANG PLAZA POMPANO INC", "R")],
      "CY2021doc-rec.txt": [doc("117300100", "04/19/2021", "D", 600000, A, 4200), doc("117400000", "03/02/2021", "M", 1000000)],
      "CY2021nme-rec.txt": [nme("117300100", "NARANG PLAZA POMPANO INC", "R"), nme("117400000", "NARANG PLAZA POMPANO INC", "D")],
      "CY2022doc-rec.txt": [doc("118000001", "01/27/2022", "M", 896000)],
      "CY2022nme-rec.txt": [nme("118000001", "NARANG PLAZA POMPANO INC", "D"), nme("118000001", "CITY NATIONAL BANK OF FLORIDA", "R")],
    });
    const objs = [base("a", A), base("b", B)];
    const ind = await cargarIndicePatrimonio(objs, lista, lector);
    const e = estimarGrupo([0, 1], objs, ind, [830000, 1540000], HOY, [2, 2]);
    expect(e.valor).toBe(2370000);
    expect(e.hipotecas.map((h) => [h.instrumento, h.origen])).toEqual([["117400000", "DUENO"], ["118000001", "DUENO"]]);
    expect(e.deudaAlta).toBe(1896000);
    expect(e.confianza).toBe("MEDIA");
    expect(e.ratio).toBe(0.2);
    expect(e.grupo).toEqual({ casos: ["CACE26014898"], dealIds: ["a", "b"], folios: [A, B] });
  });

  it("si una parcela del grupo no tiene escritura del dueno, BAJA y sin patrimonio publicado", async () => {
    const { lista, lector } = indiceFalso({
      "CY2021doc-rec.txt": [doc("117300100", "04/19/2021", "D", 600000, A, 4200)],
      "CY2021nme-rec.txt": [nme("117300100", "NARANG PLAZA POMPANO INC", "R")],
      "CY2022doc-rec.txt": [doc("118000001", "01/27/2022", "M", 896000)],
      "CY2022nme-rec.txt": [nme("118000001", "NARANG PLAZA POMPANO INC", "D")],
    });
    const objs = [base("a", A), base("b", B)];
    const ind = await cargarIndicePatrimonio(objs, lista, lector);
    const e = estimarGrupo([0, 1], objs, ind, [830000, 1540000], HOY, [2, 2]);
    expect(e.confianza).toBe("BAJA");
    expect(e.ratio).toBeNull();
    expect(e.patrimonioConservador).toBeNull();
    expect(e.motivos.join(" ")).toMatch(/sin escritura de compra/);
  });

  it("la hipoteca que la senal ya enlazo por la cadena del lis pendens cuenta como del caso", async () => {
    expect(hipotecasDeLaSenal('{"resolucionFolio":{"motivo":"lis pendens 121184045 -> hipoteca 117826189 (20211227, deudor X) -> escritura 117826188"}}')).toEqual(["117826189"]);
    const { lista, lector } = indiceFalso({
      "CY2021doc-rec.txt": [doc("117300100", "04/19/2021", "D", 600000, A, 4200), doc("117826189", "12/27/2021", "M", 400000)],
      "CY2021nme-rec.txt": [nme("117300100", "NARANG PLAZA POMPANO INC", "R"), nme("117826189", "OTRO NOMBRE LLC", "D")],
    });
    const objs = [base("a", A, { hipotecasDelCaso: ["117826189"] })];
    const ind = await cargarIndicePatrimonio(objs, lista, lector);
    const e = estimarGrupo([0], objs, ind, [830000], HOY, [1]);
    expect(e.hipotecas.map((h) => [h.instrumento, h.origen])).toEqual([["117826189", "CASO"]]);
    expect(e.confianza).toBe("ALTA");
  });
});

describe("patrimonio de Broward: control con el juicio", () => {
  const F = "494112340020";
  const ROW = "494112010029";
  const archivos = () =>
    indiceFalso({
      "CY2021doc-rec.txt": [
        doc("117508806", "08/16/2021", "D", 1250000, F, 8750),
        doc("117508807", "08/16/2021", "M", 625000),
        doc("117508900", "08/16/2021", "D", 30000, ROW, 210, 0, "", "120000"),
      ],
      "CY2021nme-rec.txt": [
        nme("117508806", "TEAM SMITH LLC", "R"),
        nme("117508807", "TEAM SMITH LLC", "D"),
        nme("117508807", "CITIZENS BANK", "R"),
        nme("117508900", "TEAM SMITH LLC", "R"),
      ],
      "CY2022doc-rec.txt": [doc("118300000", "08/30/2022", "M", 4950300)],
      "CY2022nme-rec.txt": [nme("118300000", "TEAM SMITH LLC", "D"), nme("118300000", "SYNOVUS BANK", "R")],
      "CY2022lnk-rec.txt": [lnk("118400000", "RST", "117508807", "M")],
    });
  const obj = (o: Partial<Objetivo> = {}): Objetivo => ({
    dealId: "sr7", folio: F, duenos: ["TEAM SMITH LLC"], casos: ["CACE26016148"], demandante: "Pinnacle Bank", bandaReclamo: "DESDE_250K", ...o,
  });

  it("la otra parcela del dueno es una franja del mismo juicio: la hipoteca de obra se asigna y queda bajo el agua", async () => {
    const { lista, lector } = archivos();
    const o = obj({ foliosDelCaso: [F, ROW] });
    const ind = await cargarIndicePatrimonio([o], lista, lector);
    const e = estimarPatrimonio(0, o, ind, 1834150, HOY, 2);
    expect(e.hipotecas.map((h) => [h.instrumento, h.origen, h.cancelada])).toEqual([
      ["117508807", "COMPRA", true],
      ["118300000", "DUENO", false],
    ]);
    expect(e.deudaAlta).toBe(4950300);
    expect(e.confianza).toBe("MEDIA");
    expect(e.ratio).toBeLessThan(-1);
  });

  it("sin la franja en el juicio, la de obra no se puede asignar y la de la compra esta cancelada: BAJA, no 'libre'", async () => {
    const { lista, lector } = archivos();
    const o = obj();
    const ind = await cargarIndicePatrimonio([o], lista, lector);
    const e = estimarPatrimonio(0, o, ind, 1834150, HOY, 2);
    expect(e.noAsignadas).toBe(1);
    expect(e.confianza).toBe("BAJA");
    expect(e.ratio).toBeNull();
  });

  it("un prestamista que ejecuta y ninguna hipoteca abierta encontrada: BAJA", async () => {
    const { lista, lector } = indiceFalso({
      "CY2019doc-rec.txt": [doc("116000000", "02/02/2019", "D", 300000, "514209051970", 2100)],
      "CY2019nme-rec.txt": [nme("116000000", "FIORINO,MICHAEL", "R")],
    });
    const o: Objetivo = { dealId: "x", folio: "514209051970", duenos: ["FIORINO,MICHAEL"], casos: [], demandante: "U.S. BANK TRUST, NATIONAL ASSOCIATION", bandaReclamo: "ENTRE_50K_Y_250K" };
    const ind = await cargarIndicePatrimonio([o], lista, lector);
    const e = estimarPatrimonio(0, o, ind, 460000, HOY, 1);
    expect(e.confianza).toBe("BAJA");
    expect(e.motivos.join(" ")).toMatch(/no se encontro ninguna hipoteca abierta/);
    expect(e.reclamo).toEqual({ banda: "ENTRE_50K_Y_250K", piso: 50000 });
  });

  it("la deuda encontrada menor que el tramo reclamado: BAJA", async () => {
    const { lista, lector } = indiceFalso({
      "CY2019doc-rec.txt": [doc("116000000", "02/02/2019", "D", 300000, "514209051970", 2100), doc("116000001", "02/02/2019", "M", 100000)],
      "CY2019nme-rec.txt": [nme("116000000", "FIORINO,MICHAEL", "R"), nme("116000001", "FIORINO,MICHAEL", "D")],
    });
    const o: Objetivo = { dealId: "x", folio: "514209051970", duenos: ["FIORINO,MICHAEL"], casos: [], demandante: "Some Bank NA", bandaReclamo: "DESDE_250K" };
    const ind = await cargarIndicePatrimonio([o], lista, lector);
    const e = estimarPatrimonio(0, o, ind, 460000, HOY, 1);
    expect(e.confianza).toBe("BAJA");
    expect(e.motivos.join(" ")).toMatch(/menor que el tramo/);
  });
});

describe("patrimonio de Broward: la corrida recalcula todos los estimados", () => {
  function prismaFalso(equityGuardado: { equityRatio: number | null; equityConfidence: string | null }) {
    const llamadas = { updates: 0, creates: 0 };
    const prisma = {
      dealDistressSignal: {
        findMany: async (a: { where?: { externalId?: unknown } }) =>
          a.where?.externalId
            ? [{ externalId: "CACE26000001", deal: { parcelId: "494212040070" } }]
            : [{ dealId: "d1", source: "broward-foreclosure", status: "CONFIRMED", externalId: "CACE26000001", metadata: JSON.stringify({ caption: "Some Bank NA Plaintiff vs. X LLC Defendant" }), observedAt: new Date() }],
      },
      deal: {
        findMany: async (a: { select?: Record<string, boolean> }) =>
          a.select?.equityRatio ? [equityGuardado] : [{ id: "d1", parcelId: "494212040070" }],
        update: async () => {
          llamadas.updates += 1;
          return {};
        },
      },
      dealOwner: { findMany: async () => [{ dealId: "d1", ownerId: "o1", owner: { name: "X LLC" } }] },
      mdpaAssessment: { findMany: async () => [{ dealId: "d1", taxYear: 2026, justValue: 800000 }] },
      stagingRecord: {
        findFirst: async () => ({ id: "s1" }),
        create: async () => {
          llamadas.creates += 1;
          return {};
        },
        update: async () => ({}),
      },
    };
    return { prisma, llamadas };
  }
  const archivos: ArchivoLocal[] = [
    { ruta: "CY2021doc-rec.txt", tipo: "doc", anio: 2021 },
    { ruta: "CY2021nme-rec.txt", tipo: "nme", anio: 2021 },
  ];
  const lector = async () => undefined;

  it("con el patrimonio sin cambios igual recalcula el score de todos (otra corrida pudo pisarlo)", async () => {
    const { prisma, llamadas } = prismaFalso({ equityRatio: null, equityConfidence: "BAJA" });
    const pedidos: string[][] = [];
    const r = await calcularPatrimonio(prisma as never, {
      aplicar: true, archivos, lector, hoy: new Date("2026-11-06T12:00:00Z"),
      recalcular: async (ids) => {
        pedidos.push(ids);
        return 1;
      },
    });
    expect(r.cambiados).toBe(0);
    expect(llamadas.updates).toBe(0);
    expect(pedidos).toEqual([["d1"]]);
    expect(r.puntajes).toBe(1);
  });

  it("sin aplicar no recalcula nada", async () => {
    const { prisma } = prismaFalso({ equityRatio: null, equityConfidence: "BAJA" });
    const pedidos: string[][] = [];
    await calcularPatrimonio(prisma as never, { archivos, lector, recalcular: async (ids) => (pedidos.push(ids), 0) });
    expect(pedidos).toEqual([]);
  });
});
