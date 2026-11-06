import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { esForeclosureDeInteres, leerCasoForeclosure } from "../deals/distress-classification";
import {
  aplicarInferencia,
  candidatosLisPendens,
  datosDeHipotecas,
  fechaClerk,
  hipotecaDelCaso,
  inferirTipoDeCaso,
  lisPendensActivo,
  nombreParaResolver,
  registroDesdeLisPendens,
  ventanaLocal,
} from "./lis-pendens-broward";
import type { ArchivoLocal } from "./patrimonio-broward";

const HOY = new Date("2026-11-06T12:00:00Z");
const doc = (inst: string, ymd: string, tipo: string, monto: number, caso = "") => {
  const f = `${ymd.slice(4, 6)}/${ymd.slice(6, 8)}/${ymd.slice(0, 4)}`;
  return `${inst}|${ymd}|${f}|101500|${tipo}|${monto.toFixed(2)}|||O|||||1|0|V||E|${caso}|`;
};
const nme = (inst: string, nombre: string, lado: string) => `${inst}|${nombre}|${lado}|1|`;
const lnk = (inst: string, destino: string, tipoDestino: string) => `${inst}|||O|LP|${destino}|1|1|O|${tipoDestino}|${destino}|`;

describe("lis pendens de Broward (fase 2)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lp-"));
    writeFileSync(join(dir, "11-04-2026doc-ver.txt"), [
      doc("121300001", "20261104", "LP", 0, "CACE-26-018001"), // hipoteca vieja, va al anual
      doc("121300002", "20261104", "LP", 0, "CACE-26-014898"), // ya conocido
      doc("121300003", "20261104", "LP", 0, "COCE-26-000001"), // condado, no circuito
      doc("121300004", "20261104", "LP", 0, "CACE-26-018004"), // sin hipoteca enlazada
      doc("121300005", "20261104", "M", 300000),
      doc("121300006", "20261104", "LP", 0, "CACE-26-018006"), // hipoteca en la ventana
    ].join("\n"), "latin1");
    writeFileSync(join(dir, "11-04-2026nme-ver.txt"), [
      nme("121300001", "SOME BANK NA", "D"), nme("121300001", "PEREZ,ILIAC BALLESTERO", "R"), nme("121300001", "SUNRISE HOA INC", "R"),
      nme("121300005", "NUEVO DUENO LLC", "D"),
      nme("121300006", "OTRO BANCO NA", "D"), nme("121300006", "NUEVO DUENO LLC", "R"),
    ].join("\n"), "latin1");
    writeFileSync(join(dir, "11-04-2026lnk-ver.txt"), [
      lnk("121300001", "111000050", "M"), lnk("121300002", "118000001", "M"), lnk("121300003", "111000051", "M"),
      lnk("121300004", "111000052", "D"), lnk("121300006", "121300005", "M"),
    ].join("\n"), "latin1");
    writeFileSync(join(dir, "nada.txt"), "x");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("candidatos: circuito civil, con hipoteca enlazada y caso nuevo", async () => {
    const ind = await ventanaLocal(dir);
    expect(ind.dias).toEqual(["2026-11-04"]);
    const c = candidatosLisPendens(ind, new Set(["CACE26014898"]));
    expect(c.map((x) => x.caso)).toEqual(["CACE26018001", "CACE26018006"]);
    expect(c[0]).toMatchObject({ demandantes: ["SOME BANK NA"], demandados: ["PEREZ,ILIAC BALLESTERO", "SUNRISE HOA INC"], hipotecas: ["111000050"] });
  });

  it("datos de la hipoteca: de la ventana o del anual del anio que le toca", async () => {
    const ind = await ventanaLocal(dir);
    const anuales: Record<string, string[]> = {
      "CY2012doc-rec.txt": [doc("110000000", "20120102", "D", 1), doc("111000050", "20121001", "M", 0).replace("|1|0|V", "|1|0|V").replace("||||1|0", "|1000||1|0")],
      "CY2012nme-rec.txt": [nme("111000050", "PEREZ,ILIAC BALLESTERO", "D"), nme("111000050", "SOME BANK NA", "R")],
      "CY2013doc-rec.txt": [doc("112000000", "20130102", "D", 1)],
      "CY2013nme-rec.txt": [],
    };
    // intangible 1000 en la columna 12 -> 500.000
    anuales["CY2012doc-rec.txt"][1] = "111000050|20121001|10/01/2012|101500|M|0.00|||O|||0|1000|1|0|V||E||";
    const archivos: ArchivoLocal[] = Object.keys(anuales).map((ruta) => ({ ruta, tipo: /doc/.test(ruta) ? "doc" : "nme", anio: Number(ruta.slice(2, 6)) }));
    const lector = async (ruta: string, porLinea: (l: string) => void) => anuales[ruta].forEach(porLinea);
    const c = candidatosLisPendens(ind, new Set(["CACE26014898"]));
    const datos = await datosDeHipotecas(new Set(c.flatMap((x) => x.hipotecas)), ind, archivos, lector);
    expect(datos.get("111000050")).toEqual({ instrumento: "111000050", fecha: "10/01/2012", monto: 500000, deudores: ["PEREZ,ILIAC BALLESTERO"] });
    expect(datos.get("121300005")).toEqual({ instrumento: "121300005", fecha: "11/04/2026", monto: 300000, deudores: ["NUEVO DUENO LLC"] });
    expect(hipotecaDelCaso(c[0], datos)?.instrumento).toBe("111000050");
  });

  it("el registro tiene la forma del expediente del Clerk", async () => {
    const ind = await ventanaLocal(dir);
    const [c] = candidatosLisPendens(ind, new Set(["CACE26014898"]));
    const r = registroDesdeLisPendens(c, { instrumento: "111000050", fecha: "10/01/2012", monto: 500000, deudores: ["PEREZ,ILIAC BALLESTERO"] });
    expect(r).toMatchObject({
      caseNumber: "CACE26018001",
      filedDate: "11/04/2026",
      status: "CONFIRMED",
      confidence: "MEDIUM",
      caption: "SOME BANK NA Plaintiff vs. PEREZ,ILIAC BALLESTERO, et al Defendant",
      defendantName: "ILIAC BALLESTERO PEREZ",
      origen: "lis-pendens",
    });
    expect(String(r.observedAt)).toMatch(/^2026-11-04T/);
  });

  it("inferencia: clase por la parcela, tramo por el saldo estimado; la regla de JR la lee igual que al Clerk", () => {
    const vieja = { instrumento: "x", fecha: "10/01/2005", monto: 300000, deudores: [] };
    const nueva = { instrumento: "y", fecha: "08/28/2023", monto: 554766, deudores: [] };
    const chica = { instrumento: "z", fecha: "01/01/2020", monto: 120000, deudores: [] };
    const casaNueva = inferirTipoDeCaso("Single Family (DOR 01)", nueva, HOY);
    const casaVieja = inferirTipoDeCaso("01", vieja, HOY);
    const local = inferirTipoDeCaso("Stores, one story (DOR 11)", chica, HOY);
    const sinHip = inferirTipoDeCaso("11", undefined, HOY);
    expect(casaNueva.texto).toBe("Real Prop NonHomestead Res Fore $250,000 or More (inferido del lis pendens)");
    expect(local.texto).toBe("Real Prop Comm Fore Between $50,000 and $250,000 (inferido del lis pendens)");
    const interes = (inf: ReturnType<typeof inferirTipoDeCaso>, uso: string) => {
      const r = registroDesdeLisPendens({ caso: "CACE1", lp: { instrumento: "1", fecha: "20261104", hora: "", tipo: "LP", monto: 0, libro: "", pagina: "", folio: "", caso: "CACE1" }, demandantes: ["SOME BANK NA"], demandados: ["X"], hipotecas: [] });
      aplicarInferencia(r, inf);
      return esForeclosureDeInteres(leerCasoForeclosure(JSON.stringify(r)), uso);
    };
    expect(interes(casaNueva, "01")).toBe(true); // residencial con saldo de 250K o mas
    expect(casaVieja.saldoEstimado as number).toBeLessThan(250000);
    expect(interes(casaVieja, "01")).toBe(false); // residencial de 2012: el saldo ya bajo de 250K
    expect(interes(local, "11")).toBe(true); // comercial, cualquier monto
    expect(interes(sinHip, "11")).toBe(false); // sin hipoteca no hay tramo: no dispara
    expect(inferirTipoDeCaso(null, nueva, HOY).clase).toBe("SIN_PARCELA");
  });

  it("un consorcio que ejecuta no dispara aunque se infiera el tipo", () => {
    const r = registroDesdeLisPendens({ caso: "CACE2", lp: { instrumento: "1", fecha: "20261104", hora: "", tipo: "LP", monto: 0, libro: "", pagina: "", folio: "", caso: "CACE2" }, demandantes: ["SUNRISE LAKES CONDOMINIUM ASSOCIATION INC"], demandados: ["X"], hipotecas: [] });
    aplicarInferencia(r, inferirTipoDeCaso("11", { instrumento: "m", fecha: "01/01/2024", monto: 900000, deudores: [] }, HOY));
    expect(esForeclosureDeInteres(leerCasoForeclosure(JSON.stringify(r)), "11")).toBe(false);
  });

  it("piezas", () => {
    expect(fechaClerk("20261104")).toBe("11/04/2026");
    expect(nombreParaResolver("BALLESTERO PEREZ,ILIAC")).toBe("ILIAC BALLESTERO PEREZ");
    expect(nombreParaResolver("NARANG PLAZA POMPANO, INC.")).toBe("NARANG PLAZA POMPANO, INC.");
    expect(lisPendensActivo({ BROWARD_LIS_PENDENS: "off" })).toBe(false);
    expect(lisPendensActivo({})).toBe(true);
  });
});
