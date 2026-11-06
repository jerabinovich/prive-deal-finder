import { promises as fsp } from "fs";
import { join } from "path";
import { toDorCode } from "./dor-use-codes";
import { RE_ARCHIVO_DIARIO, dirRegistroDiario } from "./registro-diario-broward";
import { agregarArchivo, indiceVacio, normalizarCaso, type DocumentoOR, type Indice } from "./registro-oficial-broward";
import { leerDocPat, leerPorLineas, montoHipoteca, saldoAmortizado, type ArchivoLocal, type Lector } from "./patrimonio-broward";

/**
 * FASE 2 (6-nov-2026, JR: "Inferir y contar"): los juicios hipotecarios de Broward que el Clerk no trajo, desde los lis
 * pendens del registro oficial (gratis).
 *
 * POR QUE: medido el 6-nov, en los 10 dias del FTP hubo 37 lis pendens de hipoteca del circuito civil y 18 no estaban
 * en el Deal Finder. El Clerk cuesta unidades (12 al 6-nov) y cuando se acaban no entra ningun juicio nuevo.
 *
 * QUE FALTA EN UN LIS PENDENS: el tipo de caso del Clerk, que la regla de JR necesita (comercial con cualquier monto;
 * residencial solo desde USD 250K). JR eligio inferirlo:
 *   clase  por la parcela que resuelve el caso: vivienda (DOR 01, 02, 04 a 08) residencial; el resto, comercial;
 *   tramo  por el saldo ESTIMADO (amortizado, el bajo) de la hipoteca que enlaza el lis pendens: es lo que se reclama.
 * El texto inferido dice "(inferido del lis pendens)". Cuando el Clerk trae el expediente, su registro pisa este
 * (misma senal: fuente broward-foreclosure y el mismo numero de caso). Sin la hipoteca no hay tramo y la regla no
 * dispara. BROWARD_LIS_PENDENS=off lo apaga sin desplegar codigo.
 */
export const ORIGEN_LIS_PENDENS = "lis-pendens";
export const TEXTO_SIN_INFERIR = "Lis pendens (tipo de caso por inferir)";
export const SUFIJO_INFERIDO = "(inferido del lis pendens)";
export const DIAS_DE_VENTANA = 10;
const DOR_RESIDENCIAL = new Set(["01", "02", "04", "05", "06", "07", "08"]);

export function lisPendensActivo(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.BROWARD_LIS_PENDENS ?? "").trim().toLowerCase() !== "off";
}

/** "20261104" -> "11/04/2026" (la forma de fecha del Clerk y de patrimonio-broward). */
export function fechaClerk(aaaammdd: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(aaaammdd ?? "").trim());
  return m ? `${m[2]}/${m[3]}/${m[1]}` : String(aaaammdd ?? "");
}

/** La ventana de los ultimos 10 dias desde el archivo propio (registro-diario-broward.ts). */
export async function ventanaLocal(
  dir = dirRegistroDiario(),
  leer: (ruta: string) => Promise<string> = (r) => fsp.readFile(r, "latin1"),
): Promise<Indice> {
  const ind = indiceVacio();
  const nombres = (await fsp.readdir(dir).catch(() => [] as string[])).filter((n) => RE_ARCHIVO_DIARIO.test(n));
  const dia = (n: string) => {
    const m = RE_ARCHIVO_DIARIO.exec(n) as RegExpExecArray;
    return `${m[3]}-${m[1]}-${m[2]}`;
  };
  const dias = [...new Set(nombres.map(dia))].sort().slice(-DIAS_DE_VENTANA);
  for (const n of nombres.filter((x) => dias.includes(dia(x))).sort()) {
    const tipo = (RE_ARCHIVO_DIARIO.exec(n) as RegExpExecArray)[4].toLowerCase() as "doc" | "nme" | "lnk";
    agregarArchivo(ind, tipo, await leer(join(dir, n)));
  }
  ind.dias = dias;
  return ind;
}

export type CandidatoLP = {
  caso: string;
  lp: DocumentoOR;
  demandantes: string[];
  demandados: string[];
  hipotecas: string[];
};

/** Lis pendens del circuito civil (CACE) que enlazan una hipoteca y cuyo caso todavia no esta en el Deal Finder. */
export function candidatosLisPendens(ind: Indice, conocidos: Set<string>): CandidatoLP[] {
  const lista: CandidatoLP[] = [];
  for (const [caso, lps] of ind.lisPendens) {
    if (!caso.startsWith("CACE") || conocidos.has(caso)) continue;
    const hipotecas = [
      ...new Set(
        lps.flatMap((lp) => (ind.enlaces.get(lp.instrumento) ?? []).filter((e) => e.tipoDestino === "M").map((e) => e.destino)),
      ),
    ];
    if (!hipotecas.length) continue;
    const lp = [...lps].sort((a, b) => a.instrumento.localeCompare(b.instrumento))[0];
    const partes = ind.partes.get(lp.instrumento) ?? [];
    lista.push({
      caso,
      lp,
      demandantes: partes.filter((p) => p.lado === "D").map((p) => p.nombre),
      demandados: partes.filter((p) => p.lado === "R").map((p) => p.nombre),
      hipotecas,
    });
  }
  return lista.sort((a, b) => a.caso.localeCompare(b.caso));
}

export type DatosHipoteca = { instrumento: string; fecha: string; monto: number; deudores: string[] };

/**
 * Fecha, monto y deudores de las hipotecas pedidas: de la ventana si estan ahi, y si no de la exportacion anual local
 * del anio que les corresponde (los instrumentos crecen con el anio: se lee solo ese archivo).
 */
export async function datosDeHipotecas(
  instrumentos: Set<string>,
  ind: Indice,
  archivos: ArchivoLocal[],
  leer: Lector = leerPorLineas,
): Promise<Map<string, DatosHipoteca>> {
  const datos = new Map<string, DatosHipoteca>();
  for (const inst of instrumentos) {
    const d = ind.docs.get(inst);
    if (d && d.tipo === "M")
      datos.set(inst, {
        instrumento: inst,
        fecha: fechaClerk(d.fecha),
        monto: d.monto,
        deudores: (ind.partes.get(inst) ?? []).filter((p) => p.lado === "D").map((p) => p.nombre),
      });
  }
  const faltan = new Set([...instrumentos].filter((i) => !datos.has(i)));
  if (!faltan.size) return datos;
  // el primer instrumento de cada exportacion anual
  const docs = archivos.filter((a) => a.tipo === "doc" && a.anio).sort((a, b) => (a.anio as number) - (b.anio as number));
  const desde: Array<{ anio: number; primero: number; ruta: string }> = [];
  for (const a of docs) {
    let primero = 0;
    await leer(a.ruta, (linea) => {
      if (primero) return;
      const d = leerDocPat(linea.replace(/^(\uFEFF|\u00EF\u00BB\u00BF)/, "").replace(/\r$/, "").split("|"));
      if (d) primero = Number(d.instrumento);
    }).catch(() => undefined);
    if (primero) desde.push({ anio: a.anio as number, primero, ruta: a.ruta });
  }
  const anioDe = (inst: string) => {
    let anio: number | null = null;
    for (const r of desde) if (r.primero <= Number(inst)) anio = r.anio;
    return anio;
  };
  const porAnio = new Map<number, Set<string>>();
  for (const i of faltan) {
    const a = anioDe(i);
    if (a) porAnio.set(a, (porAnio.get(a) ?? new Set()).add(i));
  }
  for (const [anio, buscados] of porAnio) {
    const doc = archivos.find((a) => a.tipo === "doc" && a.anio === anio);
    const nme = archivos.find((a) => a.tipo === "nme" && a.anio === anio);
    if (doc)
      await leer(doc.ruta, (linea) => {
        const i = linea.indexOf("|");
        if (!buscados.has((i < 0 ? linea : linea.slice(0, i)).replace(/^(\uFEFF|\u00EF\u00BB\u00BF)/, ""))) return;
        const d = leerDocPat(linea.replace(/^(\uFEFF|\u00EF\u00BB\u00BF)/, "").replace(/\r$/, "").split("|"));
        if (d && d.tipo === "M") datos.set(d.instrumento, { instrumento: d.instrumento, fecha: d.fecha, monto: montoHipoteca(d), deudores: [] });
      });
    if (nme)
      await leer(nme.ruta, (linea) => {
        const f = linea.replace(/^(\uFEFF|\u00EF\u00BB\u00BF)/, "").replace(/\r$/, "").split("|");
        const h = datos.get(f[0]);
        if (h && buscados.has(f[0]) && (f[2] ?? "").trim().toUpperCase() === "D" && f[1]) h.deudores.push(f[1].trim());
      });
  }
  return datos;
}

/** "BALLESTERO PEREZ,ILIAC" -> "ILIAC BALLESTERO PEREZ", la forma de la caratula que lee el resolvedor por nombre. */
export function nombreParaResolver(nombreIndice: string): string {
  const n = String(nombreIndice ?? "").trim();
  const coma = n.indexOf(",");
  if (coma <= 0 || /\b(LLC|INC|CORP|LTD|LP|TRUST|BANK|ASSOCIATION|COMPANY|CO)\b/i.test(n)) return n;
  return `${n.slice(coma + 1).trim()} ${n.slice(0, coma).trim()}`.replace(/\s+/g, " ");
}

/** La hipoteca del caso: la de monto mayor entre las que enlaza (la que se ejecuta suele ser la primera hipoteca). */
export function hipotecaDelCaso(c: CandidatoLP, datos: Map<string, DatosHipoteca>): DatosHipoteca | undefined {
  return c.hipotecas
    .map((h) => datos.get(h))
    .filter((h): h is DatosHipoteca => Boolean(h))
    .sort((a, b) => b.monto - a.monto)[0];
}

/** El registro con la forma del expediente del Clerk (connectors/broward-foreclosure.connector.ts). */
export function registroDesdeLisPendens(c: CandidatoLP, hip?: DatosHipoteca): Record<string, unknown> {
  const deudor = hip?.deudores[0] ?? c.demandados[0] ?? "";
  const demandante = c.demandantes[0] ?? "UNKNOWN PLAINTIFF";
  const caption = `${demandante} Plaintiff vs. ${deudor}${c.demandados.length > 1 ? ", et al" : ""} Defendant`;
  const filed = fechaClerk(c.lp.fecha);
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(filed);
  return {
    caseNumber: c.caso,
    caseTypeCode: TEXTO_SIN_INFERIR,
    caseTypeDescription: null,
    filedDate: filed,
    status: "CONFIRMED",
    confidence: "MEDIUM",
    observedAt: m ? new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), 4)).toISOString() : null,
    caption,
    defendantName: nombreParaResolver(deudor),
    origen: ORIGEN_LIS_PENDENS,
    lisPendens: {
      instrumento: c.lp.instrumento,
      fecha: filed,
      demandantes: c.demandantes,
      demandados: c.demandados,
      hipotecas: c.hipotecas,
      hipoteca: hip ? { instrumento: hip.instrumento, fecha: hip.fecha, monto: hip.monto, deudores: hip.deudores } : null,
    },
    metadata: { Case_Number: c.caso, Caption: caption, Case_Type: TEXTO_SIN_INFERIR, Filed_Date: filed, Origen: "Official Records lis pendens" },
  };
}

export type Inferencia = { texto: string; clase: "COMERCIAL" | "RESIDENCIAL" | "SIN_PARCELA"; saldoEstimado: number | null; dor: string | null };

/** El tipo de caso inferido, en el vocabulario del Clerk para que distress-classification lo lea igual. */
export function inferirTipoDeCaso(usoDeLaParcela: string | null | undefined, hip: DatosHipoteca | undefined, hoy: Date): Inferencia {
  const dor = toDorCode(usoDeLaParcela) ?? null;
  const saldo = hip && hip.monto > 0 ? saldoAmortizado(hip.monto, hip.fecha, hoy) : null;
  const tramo = saldo === null ? "" : saldo >= 250000 ? " $250,000 or More" : saldo > 50000 ? " Between $50,000 and $250,000" : " $50,000 or Less";
  if (!dor) return { texto: `${TEXTO_SIN_INFERIR}`, clase: "SIN_PARCELA", saldoEstimado: saldo, dor };
  const residencial = DOR_RESIDENCIAL.has(dor);
  const base = residencial ? "Real Prop NonHomestead Res Fore" : "Real Prop Comm Fore";
  return { texto: `${base}${tramo} ${SUFIJO_INFERIDO}`, clase: residencial ? "RESIDENCIAL" : "COMERCIAL", saldoEstimado: saldo, dor };
}

/** Escribe la inferencia en el registro (caseTypeCode y Case_Type, que es lo que lee distress-classification). */
export function aplicarInferencia(r: Record<string, unknown>, inf: Inferencia): void {
  r.caseTypeCode = inf.texto;
  const meta = (r.metadata && typeof r.metadata === "object" ? r.metadata : {}) as Record<string, unknown>;
  meta.Case_Type = inf.texto;
  r.metadata = meta;
  const lp = (r.lisPendens && typeof r.lisPendens === "object" ? r.lisPendens : {}) as Record<string, unknown>;
  lp.inferido = { clase: inf.clase, dor: inf.dor, saldoEstimado: inf.saldoEstimado };
  r.lisPendens = lp;
}

export const casoNormalizado = (c: string | null | undefined) => normalizarCaso(c);
