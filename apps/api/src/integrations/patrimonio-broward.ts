import { createReadStream, promises as fsp } from "fs";
import { homedir } from "os";
import { join } from "path";
import { demandanteDeCaratula, fuerzaCoincidencia, limpiarNombre, type Demandado } from "./broward-demandado";
import { nombreComoDemandado } from "./registro-oficial-broward";
import { esDemandanteConsorcio, esDemandanteMunicipio, leerCasoForeclosure, RE_PRESTAMISTA, type BandaMonto } from "../deals/distress-classification";
import { RE_ARCHIVO_DIARIO, dirRegistroDiario } from "./registro-diario-broward";

/**
 * PATRIMONIO ESTIMADO DE UN DEAL DE BROWARD (6-nov-2026, JR: "haz el 1, 2 y 3", "the most comprehensive").
 *
 * QUE: tasacion del catastro estatal (MdpaAssessment, rol vigente) menos la deuda hipotecaria abierta que se puede
 * leer en el registro oficial del condado, y la clase del acreedor que ejecuta. JR decidio el 6-nov que entre al score
 * (con tope y segun la confianza) y que la alerta ordene por patrimonio. Reemplaza, para Broward, el "solo informativo"
 * del 22-sep, que era sobre el indice por folio del Clerk de Miami-Dade (sin satisfacciones).
 *
 * DE DONDE: el indice del registro oficial ya bajado en el Spark: exportaciones anuales 2005 a 2025 en ~/broward-or/raw
 * (CYaaaa{doc,nme,lnk}-rec.txt) y el archivo propio de la ventana diaria (registro-diario-broward.ts). Gratis.
 *
 * EL LIMITE QUE DEFINE EL DISENO (medido el 16-sep): Broward indexa por folio solo las escrituras; las hipotecas no
 * traen folio. Por eso una hipoteca se atribuye a la parcela solo por tres caminos, en este orden:
 *   CASO    la hipoteca que enlaza el lis pendens del juicio (la que se esta ejecutando),
 *   COMPRA  la que se registro pegada a la escritura de compra del folio (mismo dia, hasta 3 instrumentos despues),
 *   DUENO   cualquier otra del dueno despues de la compra, SOLO si en el registro el dueno tiene esta unica parcela.
 * Con mas de una parcela, las del dueno que no son del caso ni de la compra no se pueden asignar: se anotan y la
 * confianza baja.
 *
 * LO QUE NO DA: el registro publica el principal original, no el saldo. El saldo va en un rango: abajo, amortizado a
 * 30 anios con la tasa media del anio (Freddie Mac PMMS); arriba, el principal entero (prestamo comercial interest
 * only o con balloon). El patrimonio que cuenta para el score es el conservador: tasacion menos la deuda alta.
 */

export const FUENTE_PATRIMONIO = "patrimonio-estimado";
export const VERSION_PATRIMONIO = 1;

/** Freddie Mac PMMS, promedio anual 30 anios fijo (la misma tabla de estimar_deuda.py del 16-sep). */
export const TASA_ANUAL: Record<number, number> = {
  2005: 0.0587, 2006: 0.0641, 2007: 0.0634, 2008: 0.0603, 2009: 0.0504, 2010: 0.0469, 2011: 0.0445, 2012: 0.0366,
  2013: 0.0398, 2014: 0.0417, 2015: 0.0385, 2016: 0.0365, 2017: 0.0399, 2018: 0.0454, 2019: 0.0394, 2020: 0.0311,
  2021: 0.0296, 2022: 0.0534, 2023: 0.0681, 2024: 0.0672, 2025: 0.065,
};
const ULTIMA_TASA = 0.065;

export type Confianza = "ALTA" | "MEDIA" | "BAJA" | "SIN_DATOS";
export type ClaseAcreedor = "BANCO" | "PRIVADO" | "CONSORCIO" | "MUNICIPIO" | "SIN_JUICIO" | "DESCONOCIDO";
export type OrigenHipoteca = "CASO" | "COMPRA" | "DUENO";

export type DocPat = {
  instrumento: string;
  fecha: string; // MM/DD/AAAA
  hora: string;
  tipo: string;
  monto: number;
  folio: string;
  caso: string;
  sello: number;
  intangible: number;
};

const BOM = /^(\uFEFF|\u00EF\u00BB\u00BF)/;
const campos = (linea: string) => linea.replace(BOM, "").replace(/\r$/, "").split("|");
const num = (s?: string) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const soloDigitos = (s?: string) => /^\d+$/.test(s ?? "");

/** Fila de doc-rec: instrumento|fecha aaaammdd|fecha mm/dd/aaaa|hora|tipo|monto|libro|pagina|...|folio(10)|sello(11)|intangible(12)|...|caso(18) */
export function leerDocPat(f: string[]): DocPat | null {
  if (f.length < 11 || !soloDigitos(f[0])) return null;
  return {
    instrumento: f[0],
    fecha: (f[2] ?? "").trim(),
    hora: (f[3] ?? "").trim(),
    tipo: (f[4] ?? "").trim().toUpperCase(),
    monto: num(f[5]),
    folio: (f[10] ?? "").trim().toUpperCase(),
    sello: num(f[11]),
    intangible: num(f[12]),
    caso: (f[18] ?? "").trim(),
  };
}

/** Monto de una hipoteca: el del indice o, si vino en 0, el que se deduce del impuesto intangible (0,2%) o del sello (0,35%). */
export function montoHipoteca(d: Pick<DocPat, "monto" | "sello" | "intangible">): number {
  if (d.monto > 0) return d.monto;
  if (d.intangible > 0) return Math.round(d.intangible / 0.002);
  if (d.sello > 0) return Math.round(d.sello / 0.0035);
  return 0;
}

/** Precio de una escritura: el del indice o el que se deduce del sello documental (0,7%). */
export function montoEscritura(d: Pick<DocPat, "monto" | "sello">): number {
  if (d.monto > 0) return d.monto;
  return d.sello > 0 ? Math.round(d.sello / 0.007) : 0;
}

export function anioDe(fecha: string): number {
  const m = /(\d{4})$/.exec(fecha) ?? /^(\d{4})/.exec(fecha);
  return m ? Number(m[1]) : 0;
}
export function claveFecha(fecha: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fecha);
  return m ? `${m[3]}${m[1]}${m[2]}` : fecha.replace(/[^0-9]/g, "");
}

/** Saldo amortizado a 30 anios con la tasa del anio de la hipoteca, a la fecha indicada. */
export function saldoAmortizado(principal: number, fecha: string, hoy: Date): number {
  const f = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(fecha);
  if (!f || principal <= 0) return principal;
  const anio = Number(f[3]);
  const mes = Number(f[1]);
  const i = (TASA_ANUAL[anio] ?? ULTIMA_TASA) / 12;
  const n = 360;
  const k = (hoy.getUTCFullYear() - anio) * 12 + (hoy.getUTCMonth() + 1 - mes);
  if (k <= 0) return principal;
  if (k >= n) return 0;
  const p = Math.pow(1 + i, n);
  return Math.max(0, Math.round((principal * (p - Math.pow(1 + i, k))) / (p - 1)));
}

/** Clase del acreedor por el demandante de la caratula del juicio. */
export function claseAcreedor(demandante: string | null | undefined): ClaseAcreedor {
  const d = String(demandante ?? "").toUpperCase().trim();
  if (!d) return "SIN_JUICIO";
  if (esDemandanteConsorcio(d)) return "CONSORCIO";
  if (esDemandanteMunicipio(d)) return "MUNICIPIO";
  if (/\b(FUNDING|CAPITAL|PRIVATE|INVEST(MENT|MENTS|ORS)?|EQUITY|HOLDINGS|PARTNERS|VENTURES?|FUND)\b/.test(d) && !/\bBANK\b/.test(d))
    return "PRIVADO";
  if (RE_PRESTAMISTA.test(d)) return "BANCO";
  // Una persona ("Morgan B. Lea, et al"): prestamista privado.
  if (!/\b(LLC|INC|CORP|LTD|LP|COMPANY|CO)\b/.test(d)) return "PRIVADO";
  return "DESCONOCIDO";
}

// ---------------------------------------------------------------------------------------------------------------
// El indice: solo lo que tiene que ver con los objetivos.

export type Objetivo = {
  dealId: string;
  folio: string;
  duenos: string[]; // como estan en el catastro
  casos: string[]; // numeros de caso del juicio (normalizados)
  demandante: string | null;
  /** Hipotecas que la senal ya enlazo por la cadena del lis pendens (resolucionFolio REGISTRO_OFICIAL). */
  hipotecasDelCaso?: string[];
  /** Tramo del monto reclamado segun el tipo de caso del Clerk: la deuda real no puede ser menor. */
  bandaReclamo?: BandaMonto | null;
  /** Todos los folios que el mismo juicio toca en la base, tambien los marcados como ruido (una franja, una servidumbre). */
  foliosDelCaso?: string[];
};

export type ParteCorta = { nombre: string; lado: string };
export type IndicePat = {
  docs: Map<string, DocPat>;
  partes: Map<string, ParteCorta[]>;
  /** instrumento -> los objetivos (por indice) que son parte, y de que lado */
  delDueno: Map<string, Array<{ obj: number; lado: string }>>;
  /** destino -> enlaces que lo cancelan, ceden o modifican */
  haciaDestino: Map<string, Array<{ instrumento: string; tipo: string }>>;
  /** instrumento de lis pendens -> hipotecas que enlaza */
  delLisPendens: Map<string, string[]>;
  cobertura: { desde: string | null; hasta: string | null; anios: number[]; dias: string[] };
};

export const normalizarCaso = (c: string | null | undefined) => String(c ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export type ArchivoLocal = { ruta: string; tipo: "doc" | "nme" | "lnk"; anio?: number; dia?: string };

/** Los archivos que hay en el Spark: anuales y diarios, ordenados. */
export async function archivosLocales(
  dirAnual = join(homedir(), "broward-or", "raw"),
  dirDiario = dirRegistroDiario(),
): Promise<ArchivoLocal[]> {
  const lista: ArchivoLocal[] = [];
  for (const n of (await fsp.readdir(dirAnual).catch(() => [] as string[])).sort()) {
    const m = /^CY(\d{4})(doc|nme|lnk)-rec\.txt$/i.exec(n);
    if (m) lista.push({ ruta: join(dirAnual, n), tipo: m[2].toLowerCase() as ArchivoLocal["tipo"], anio: Number(m[1]) });
  }
  for (const n of (await fsp.readdir(dirDiario).catch(() => [] as string[])).sort()) {
    const m = RE_ARCHIVO_DIARIO.exec(n);
    if (m) lista.push({ ruta: join(dirDiario, n), tipo: m[4].toLowerCase() as ArchivoLocal["tipo"], dia: `${m[3]}-${m[1]}-${m[2]}` });
  }
  return lista;
}

export type Lector = (ruta: string, porLinea: (linea: string) => void) => Promise<void>;

export const leerPorLineas: Lector = (ruta, porLinea) =>
  new Promise<void>((ok, mal) => {
    let resto = "";
    createReadStream(ruta)
      .on("data", (b: Buffer | string) => {
        const lineas = (resto + (typeof b === "string" ? b : b.toString("latin1"))).split("\n");
        resto = lineas.pop() ?? "";
        for (const l of lineas) porLinea(l);
      })
      .on("end", () => {
        if (resto) porLinea(resto);
        ok();
      })
      .on("error", mal);
  });

/** Primer token util de un nombre del indice, para descartar rapido las lineas que no pueden ser de ningun dueno. */
function tokensClave(nombre: string): string[] {
  return limpiarNombre(nombre)
    .replace(/,/g, " ")
    .split(" ")
    .filter((t) => t.length >= 2);
}

const TIPOS_QUE_IMPORTAN = new Set(["M", "D", "LP", "MOD", "AST", "RST", "SAT", "REL", "LIE", "FJ", "CFJ", "NCL", "AGR"]);

/**
 * Lee el indice una vez por tipo de archivo y se queda con: los instrumentos donde un dueno es parte, las escrituras de
 * los folios, los lis pendens de los casos, los 3 instrumentos que siguen a cada escritura del folio (la hipoteca de
 * la compra), los enlaces hacia todo eso y las partes de todos esos instrumentos.
 */
export async function cargarIndicePatrimonio(
  objetivos: Objetivo[],
  archivos: ArchivoLocal[],
  leer: Lector = leerPorLineas,
): Promise<IndicePat> {
  const ind: IndicePat = {
    docs: new Map(),
    partes: new Map(),
    delDueno: new Map(),
    haciaDestino: new Map(),
    delLisPendens: new Map(),
    cobertura: { desde: null, hasta: null, anios: [], dias: [] },
  };
  const analizados: Array<Array<{ d: Demandado; claves: Set<string> }>> = objetivos.map((o) =>
    o.duenos
      // el dueno viene del catastro ("APELLIDO,NOMBRE MEDIO" o la sociedad): la misma forma que el indice
      .map((n) => nombreComoDemandado(n))
      .filter((d): d is Demandado => Boolean(d))
      .map((d) => ({
        d,
        claves: new Set(
          d.tipo === "EMPRESA" ? tokensClave(d.nucleo).slice(0, 1) : [d.apellido.split(" ")[0], ...(d.apellidoCompuesto ? [d.apellidoCompuesto.split(" ")[0]] : [])],
        ),
      })),
  );
  const porClave = new Map<string, number[]>();
  analizados.forEach((lista, i) => lista.forEach((a) => a.claves.forEach((k) => porClave.set(k, [...(porClave.get(k) ?? []), i]))));
  const folios = new Map<string, number[]>();
  objetivos.forEach((o, i) => o.folio && folios.set(o.folio.toUpperCase(), [...(folios.get(o.folio.toUpperCase()) ?? []), i]));
  const casos = new Set(objetivos.flatMap((o) => o.casos.map(normalizarCaso)).filter(Boolean));

  const anios = new Set<number>();
  const dias = new Set<string>();
  for (const a of archivos) {
    if (a.anio) anios.add(a.anio);
    if (a.dia) dias.add(a.dia);
  }
  ind.cobertura.anios = [...anios].sort();
  ind.cobertura.dias = [...dias].sort();
  ind.cobertura.desde = ind.cobertura.anios.length ? `${ind.cobertura.anios[0]}-01-01` : ind.cobertura.dias[0] ?? null;
  ind.cobertura.hasta = ind.cobertura.dias.length
    ? ind.cobertura.dias[ind.cobertura.dias.length - 1]
    : ind.cobertura.anios.length
      ? `${ind.cobertura.anios[ind.cobertura.anios.length - 1]}-12-31`
      : null;

  // 1) nombres: donde un dueno es parte
  for (const a of archivos.filter((x) => x.tipo === "nme")) {
    await leer(a.ruta, (linea) => {
      const f = campos(linea);
      if (f.length < 3 || !soloDigitos(f[0]) || !f[1]) return;
      const toks = tokensClave(f[1]);
      const posibles = new Set<number>();
      for (const t of toks) for (const i of porClave.get(t) ?? []) posibles.add(i);
      if (!posibles.size) return;
      for (const i of posibles) {
        if (analizados[i].some((x) => fuerzaCoincidencia(x.d, f[1]) > 0)) {
          const lista = ind.delDueno.get(f[0]) ?? [];
          if (!lista.some((y) => y.obj === i && y.lado === (f[2] ?? "").trim().toUpperCase()))
            lista.push({ obj: i, lado: (f[2] ?? "").trim().toUpperCase() });
          ind.delDueno.set(f[0], lista);
        }
      }
    });
  }

  // 2) documentos: los del dueno, las escrituras del folio (y los 3 que siguen), los lis pendens del caso
  const buscados = new Set<string>();
  for (const a of archivos.filter((x) => x.tipo === "doc")) {
    let siguen = 0;
    await leer(a.ruta, (linea) => {
      const d = leerDocPat(campos(linea));
      if (!d) return;
      const delDueno = ind.delDueno.has(d.instrumento);
      const delFolio = d.folio && folios.has(d.folio);
      const lpDelCaso = d.tipo === "LP" && casos.has(normalizarCaso(d.caso));
      if ((delDueno && TIPOS_QUE_IMPORTAN.has(d.tipo)) || delFolio || lpDelCaso || siguen > 0) {
        ind.docs.set(d.instrumento, d);
        buscados.add(d.instrumento);
      }
      siguen = delFolio && d.tipo === "D" ? 3 : Math.max(0, siguen - 1);
    });
  }

  // 3) enlaces: lo que cancela, cede o modifica esos documentos, y las hipotecas que enlaza cada lis pendens
  const lps = new Set([...ind.docs.values()].filter((d) => d.tipo === "LP").map((d) => d.instrumento));
  const hipotecasDeLp = new Set<string>();
  for (const a of archivos.filter((x) => x.tipo === "lnk")) {
    await leer(a.ruta, (linea) => {
      const f = campos(linea);
      if (f.length < 6 || !soloDigitos(f[0]) || !soloDigitos(f[5])) return;
      const tipo = (f[4] ?? "").trim().toUpperCase();
      if (ind.docs.has(f[5])) {
        const lista = ind.haciaDestino.get(f[5]) ?? [];
        lista.push({ instrumento: f[0], tipo });
        ind.haciaDestino.set(f[5], lista);
      }
      if (lps.has(f[0]) && (f[9] ?? "").trim().toUpperCase() === "M") {
        ind.delLisPendens.set(f[0], [...(ind.delLisPendens.get(f[0]) ?? []), f[5]]);
        hipotecasDeLp.add(f[5]);
      }
    });
  }

  for (const o of objetivos) for (const h of o.hipotecasDelCaso ?? []) hipotecasDeLp.add(h);
  // 4) la hipoteca que ejecuta el juicio, si es de otro nombre o no estaba
  const faltan = new Set([...hipotecasDeLp].filter((h) => !ind.docs.has(h)));
  if (faltan.size) {
    for (const a of archivos.filter((x) => x.tipo === "doc")) {
      await leer(a.ruta, (linea) => {
        const i = linea.indexOf("|");
        const inst = (i < 0 ? linea : linea.slice(0, i)).replace(BOM, "");
        if (!faltan.has(inst)) return;
        const d = leerDocPat(campos(linea));
        if (d) {
          ind.docs.set(d.instrumento, d);
          buscados.add(d.instrumento);
        }
      });
    }
    // sus cancelaciones
    for (const a of archivos.filter((x) => x.tipo === "lnk")) {
      await leer(a.ruta, (linea) => {
        const f = campos(linea);
        if (f.length < 6 || !faltan.has(f[5])) return;
        const lista = ind.haciaDestino.get(f[5]) ?? [];
        lista.push({ instrumento: f[0], tipo: (f[4] ?? "").trim().toUpperCase() });
        ind.haciaDestino.set(f[5], lista);
      });
    }
  }

  // 5) partes de todo lo que se guardo (acreedores, vendedores)
  for (const a of archivos.filter((x) => x.tipo === "nme")) {
    await leer(a.ruta, (linea) => {
      const i = linea.indexOf("|");
      const inst = (i < 0 ? linea : linea.slice(0, i)).replace(BOM, "");
      if (!buscados.has(inst)) return;
      const f = campos(linea);
      if (f.length < 3 || !f[1]) return;
      const lista = ind.partes.get(inst) ?? [];
      lista.push({ nombre: f[1].trim(), lado: (f[2] ?? "").trim().toUpperCase() });
      ind.partes.set(inst, lista);
    });
  }
  return ind;
}

// ---------------------------------------------------------------------------------------------------------------
// La cuenta, pura.

export type HipotecaEstimada = {
  instrumento: string;
  fecha: string;
  principal: number;
  saldoBajo: number;
  saldoAlto: number;
  acreedores: string[];
  origen: OrigenHipoteca;
  cancelada: boolean;
};

export type Estimacion = {
  version: number;
  dealId: string;
  folio: string;
  calculado: string;
  valor: number | null;
  compra: { fecha: string; precio: number; instrumento: string } | null;
  hipotecas: HipotecaEstimada[];
  noAsignadas: number;
  deudaBaja: number;
  deudaAlta: number;
  patrimonioConservador: number | null;
  patrimonioOptimista: number | null;
  ratio: number | null;
  confianza: Confianza;
  acreedor: ClaseAcreedor;
  demandante: string | null;
  otrosGravamenes: string[];
  cartera: { parcelasEnRegistro: number; folios: string[] };
  grupo: { casos: string[]; dealIds: string[]; folios: string[] };
  reclamo: { banda: BandaMonto | null; piso: number };
  cobertura: IndicePat["cobertura"];
  motivos: string[];
};

const CANCELA = new Set(["RST", "RSTX", "SAT", "REL", "REL CORP", "RELM"]);

/** Folios que el dueno compro (lado R de una escritura con folio) y no vendio despues (lado D de una escritura del mismo folio). */
export function carteraDelDueno(objIdx: number, ind: IndicePat): string[] {
  const ultima = new Map<string, { k: string; compra: boolean }>();
  for (const [inst, lados] of ind.delDueno) {
    const d = ind.docs.get(inst);
    if (!d || d.tipo !== "D" || !d.folio) continue;
    for (const x of lados) {
      if (x.obj !== objIdx) continue;
      const k = claveFecha(d.fecha) + inst;
      const prev = ultima.get(d.folio);
      if (!prev || k > prev.k) ultima.set(d.folio, { k, compra: x.lado === "R" });
    }
  }
  return [...ultima.entries()].filter(([, v]) => v.compra).map(([f]) => f).sort();
}

/** La ultima escritura del folio donde el dueno recibe (lado R). */
function compraDelFolio(objIdx: number, folio: string, ind: IndicePat): Estimacion["compra"] {
  let compra: Estimacion["compra"] = null;
  for (const d of ind.docs.values()) {
    if (d.tipo !== "D" || d.folio !== folio) continue;
    if (!(ind.delDueno.get(d.instrumento) ?? []).some((x) => x.obj === objIdx && x.lado === "R")) continue;
    if (!compra || claveFecha(d.fecha) > claveFecha(compra.fecha)) compra = { fecha: d.fecha, precio: montoEscritura(d), instrumento: d.instrumento };
  }
  return compra;
}

/**
 * Agrupa los objetivos que comparten un juicio (6-nov-2026, punto 2). Un mismo caso suele ejecutar varias parcelas del
 * mismo dueno (CNB contra Narang Plaza Pompano: 350 E McNab y 2 NE 3 St); la deuda es del grupo y el patrimonio
 * tambien. Devuelve grupos de indices; un objetivo sin caso compartido queda solo.
 */
export function gruposPorCaso(objetivos: Objetivo[]): number[][] {
  const padre = objetivos.map((_, i) => i);
  const raiz = (i: number): number => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
  const primero = new Map<string, number>();
  objetivos.forEach((o, i) =>
    o.casos.map(normalizarCaso).filter(Boolean).forEach((c) => {
      const j = primero.get(c);
      if (j === undefined) primero.set(c, i);
      else padre[raiz(i)] = raiz(j);
    }),
  );
  const grupos = new Map<number, number[]>();
  objetivos.forEach((_, i) => grupos.set(raiz(i), [...(grupos.get(raiz(i)) ?? []), i]));
  return [...grupos.values()];
}

/**
 * La cuenta de un grupo (una parcela sola es un grupo de uno). La tasacion es la suma; la deuda, la de las hipotecas
 * atribuibles a alguna de sus parcelas; las del dueno sin folio solo cuentan si todas las parcelas tienen escritura
 * de compra y el dueno no tiene en el registro parcelas fuera del grupo.
 */
export function estimarGrupo(
  miembros: number[],
  objetivos: Objetivo[],
  ind: IndicePat,
  valores: Array<number | null>,
  hoy: Date,
  carteraEnBase: number[] = [],
): Omit<Estimacion, "dealId" | "folio"> {
  const motivos: string[] = [];
  const lados = (inst: string) => (ind.delDueno.get(inst) ?? []).filter((x) => miembros.includes(x.obj)).map((x) => x.lado);
  const folios = miembros.map((i) => objetivos[i].folio.toUpperCase());
  const compras = miembros.map((i, k) => compraDelFolio(i, folios[k], ind));
  const todasConCompra = compras.every(Boolean);
  const desde = compras.filter((c): c is NonNullable<typeof c> => Boolean(c)).map((c) => claveFecha(c.fecha)).sort()[0] ?? null;

  const acreedoresDe = (inst: string) => (ind.partes.get(inst) ?? []).filter((p) => p.lado === "R").map((p) => p.nombre);
  const cancelada = (inst: string) => (ind.haciaDestino.get(inst) ?? []).some((e) => CANCELA.has(e.tipo));
  const elegidas = new Map<string, OrigenHipoteca>();

  // CASO: la hipoteca que enlaza el lis pendens del juicio, en el indice o en la cadena que ya guardo la senal
  const casos = new Set(miembros.flatMap((i) => objetivos[i].casos.map(normalizarCaso)));
  for (const d of ind.docs.values()) {
    if (d.tipo !== "LP" || !casos.has(normalizarCaso(d.caso))) continue;
    for (const h of ind.delLisPendens.get(d.instrumento) ?? []) if (ind.docs.has(h)) elegidas.set(h, "CASO");
  }
  for (const i of miembros) for (const h of objetivos[i].hipotecasDelCaso ?? []) if (ind.docs.has(h)) elegidas.set(h, "CASO");
  // COMPRA: hasta 3 instrumentos despues de cada escritura, el mismo dia, del dueno como deudor
  for (const c of compras) {
    if (!c) continue;
    const base = Number(c.instrumento);
    for (let k = 1; k <= 3; k += 1) {
      const inst = String(base + k).padStart(c.instrumento.length, "0");
      const d = ind.docs.get(inst);
      if (!d) continue;
      if (d.fecha !== c.fecha) break;
      if (d.tipo === "M" && lados(inst).includes("D") && !elegidas.has(inst)) elegidas.set(inst, "COMPRA");
    }
  }
  // DUENO: las demas del dueno despues de la primera compra, solo si el dueno no tiene parcelas fuera del grupo
  const cartera = [...new Set(miembros.flatMap((i) => carteraDelDueno(i, ind)))].sort();
  const delCaso = new Set([...folios, ...miembros.flatMap((i) => (objetivos[i].foliosDelCaso ?? []).map((f) => f.toUpperCase()))]);
  const fuera = cartera.filter((f) => !delCaso.has(f));
  const enBase = Math.max(0, ...miembros.map((i) => carteraEnBase[i] ?? 0));
  const soloElGrupo = todasConCompra && !fuera.length && enBase <= delCaso.size;
  const sinAsignar: string[] = [];
  for (const [inst] of ind.delDueno) {
    const d = ind.docs.get(inst);
    if (!d || d.tipo !== "M" || elegidas.has(inst) || !lados(inst).includes("D")) continue;
    // sin compra en el indice no hay desde cuando contar: las del dueno pueden ser de otra parcela que ya vendio
    if (!desde || claveFecha(d.fecha) < desde) continue;
    if (soloElGrupo) elegidas.set(inst, "DUENO");
    else sinAsignar.push(inst);
  }

  const hipotecas: HipotecaEstimada[] = [...elegidas.entries()]
    .map(([inst, origen]) => {
      const d = ind.docs.get(inst) as DocPat;
      const principal = montoHipoteca(d);
      const canc = cancelada(inst);
      return {
        instrumento: inst,
        fecha: d.fecha,
        principal,
        saldoBajo: canc ? 0 : saldoAmortizado(principal, d.fecha, hoy),
        saldoAlto: canc ? 0 : principal,
        acreedores: acreedoresDe(inst),
        origen,
        cancelada: canc,
      };
    })
    .sort((a, b) => claveFecha(a.fecha).localeCompare(claveFecha(b.fecha)));
  const noAsignadas = sinAsignar.filter((i) => !cancelada(i)).length;
  const deudaBaja = hipotecas.reduce((s, h) => s + h.saldoBajo, 0);
  const deudaAlta = hipotecas.reduce((s, h) => s + h.saldoAlto, 0);

  const otros = new Set<string>();
  for (const [inst] of ind.delDueno) {
    const d = ind.docs.get(inst);
    if (!d || d.tipo !== "LIE" || !lados(inst).includes("R") || cancelada(inst)) continue;
    if (desde && claveFecha(d.fecha) < desde) continue;
    otros.add(`gravamen ${d.fecha}`);
  }

  const vals = miembros.map((i) => valores[i]);
  const valor = vals.every((v) => typeof v === "number" && v > 0) ? (vals as number[]).reduce((s, v) => s + v, 0) : null;
  const primerAnio = ind.cobertura.anios[0] ?? 9999;
  const ultimoAnio = ind.cobertura.anios[ind.cobertura.anios.length - 1] ?? 0;
  const conCasoOCompra = [...elegidas.values()].some((o) => o === "CASO" || o === "COMPRA");
  let confianza: Confianza;
  if (valor === null) {
    confianza = "SIN_DATOS";
    motivos.push(miembros.length > 1 ? "alguna parcela del grupo sin tasacion del catastro" : "sin tasacion del catastro");
  } else if (!todasConCompra) {
    confianza = "BAJA";
    motivos.push(
      `${miembros.length > 1 ? "alguna parcela del grupo" : "la parcela"} sin escritura de compra del dueno en el registro (${primerAnio} a ${ultimoAnio} y ${ind.cobertura.dias.length} dias del archivo diario): compra anterior, del anio en curso, o folio nuevo por division`,
    );
  } else if (noAsignadas && !hipotecas.some((h) => h.origen === "CASO" && !h.cancelada)) {
    confianza = "BAJA";
    motivos.push(`${noAsignadas} hipoteca(s) del dueno sin folio que no se pueden asignar (el dueno tiene parcelas fuera de este ${miembros.length > 1 ? "grupo" : "deal"}) y no se encontro la hipoteca abierta del caso`);
  } else if (noAsignadas) {
    // la del caso es de esta parcela y esta abierta; las otras del dueno, lo mas probable, de sus otras parcelas
    confianza = "MEDIA";
    motivos.push(`${noAsignadas} hipoteca(s) del dueno sin folio no asignadas: el dueno tiene parcelas fuera de este ${miembros.length > 1 ? "grupo" : "deal"}`);
  } else if (conCasoOCompra) {
    confianza = [...elegidas.values()].some((o) => o === "DUENO") ? "MEDIA" : "ALTA";
  } else {
    confianza = "MEDIA";
    motivos.push(
      elegidas.size ? "hipotecas del dueno despues de la compra, atribuidas porque no tiene otras parcelas" : "sin hipotecas del dueno despues de la compra: libre de deuda registrada",
    );
  }
  // Control con el juicio: si ejecuta un prestamista, la deuda abierta no puede ser menor que el tramo reclamado.
  const PISO: Record<string, number> = { DESDE_250K: 250000, ENTRE_50K_Y_250K: 50000, HASTA_50K: 1 };
  const bandas = miembros.map((i) => objetivos[i].bandaReclamo ?? null).filter((b): b is BandaMonto => Boolean(b) && b !== "DESCONOCIDA");
  const banda = bandas.sort((a, b) => (PISO[b] ?? 0) - (PISO[a] ?? 0))[0] ?? null;
  const piso = banda ? PISO[banda] ?? 0 : 0;
  const acreedor = claseAcreedor(miembros.map((i) => objetivos[i].demandante).find(Boolean) ?? null);
  const esPrestamista = acreedor === "BANCO" || acreedor === "PRIVADO" || acreedor === "DESCONOCIDO";
  if ((confianza === "ALTA" || confianza === "MEDIA") && esPrestamista && (deudaAlta === 0 || deudaAlta < piso)) {
    confianza = "BAJA";
    motivos.push(
      deudaAlta === 0
        ? "el juicio es de un prestamista y no se encontro ninguna hipoteca abierta: falta la que se ejecuta"
        : `la deuda encontrada (${deudaAlta}) es menor que el tramo que reclama el juicio (desde ${piso}): falta alguna hipoteca`,
    );
  }
  if (compras.some((c) => c && anioDe(c.fecha) < primerAnio)) motivos.push("compra anterior a la cobertura");
  if (miembros.length > 1) motivos.push(`grupo de ${miembros.length} parcelas del mismo juicio: tasacion y deuda sumadas`);

  // Con confianza BAJA o sin tasacion no se publica un patrimonio: la deuda conocida puede ser parcial.
  const publica = confianza === "ALTA" || confianza === "MEDIA";
  const patrimonioConservador = publica && valor ? Math.round(valor - deudaAlta) : null;
  const patrimonioOptimista = publica && valor ? Math.round(valor - deudaBaja) : null;
  const ratio = patrimonioConservador !== null && valor ? Math.round((patrimonioConservador / valor) * 1000) / 1000 : null;

  return {
    version: VERSION_PATRIMONIO,
    calculado: hoy.toISOString(),
    valor,
    compra: compras[0] ?? null,
    hipotecas,
    noAsignadas,
    deudaBaja,
    deudaAlta,
    patrimonioConservador,
    patrimonioOptimista,
    ratio,
    confianza,
    acreedor,
    demandante: miembros.map((i) => objetivos[i].demandante).find(Boolean) ?? null,
    otrosGravamenes: [...otros],
    cartera: { parcelasEnRegistro: cartera.length, folios: cartera.slice(0, 20) },
    grupo: { casos: [...casos].sort(), dealIds: miembros.map((i) => objetivos[i].dealId), folios },
    reclamo: { banda, piso },
    cobertura: ind.cobertura,
    motivos,
  };
}

/** Una parcela sola (grupo de uno). */
export function estimarPatrimonio(
  objIdx: number,
  obj: Objetivo,
  ind: IndicePat,
  valor: number | null,
  hoy: Date,
  carteraEnBase = 0,
): Estimacion {
  const objetivos: Objetivo[] = [];
  objetivos[objIdx] = obj;
  const valores: Array<number | null> = [];
  valores[objIdx] = valor;
  const cartera: number[] = [];
  cartera[objIdx] = carteraEnBase;
  return { dealId: obj.dealId, folio: obj.folio.toUpperCase(), ...estimarGrupo([objIdx], objetivos, ind, valores, hoy, cartera) };
}

/** Las hipotecas que la senal ya enlazo por la cadena del registro oficial ("lis pendens X -> hipoteca Y ..."). */
export function hipotecasDeLaSenal(metadata: string | null | undefined): string[] {
  return [...new Set([...String(metadata ?? "").matchAll(/hipoteca (\d{6,})/g)].map((m) => m[1]))];
}

/** El demandante de la senal del juicio (caratula del Clerk), si hay. */
export function demandanteDeSenal(metadata: string | null | undefined): string | null {
  try {
    const raw = JSON.parse(String(metadata ?? "{}")) as Record<string, unknown>;
    const interno = (raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {}) as Record<string, unknown>;
    const caption = String(raw.caption ?? interno.Caption ?? "");
    const d = demandanteDeCaratula(caption);
    return d || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// La corrida sobre la base.

type PrismaPat = {
  deal: {
    findMany: (a: unknown) => Promise<Array<Record<string, unknown>>>;
    update: (a: unknown) => Promise<unknown>;
  };
  dealOwner: { findMany: (a: unknown) => Promise<Array<Record<string, unknown>>> };
  dealDistressSignal: { findMany: (a: unknown) => Promise<Array<Record<string, unknown>>> };
  mdpaAssessment: { findMany: (a: unknown) => Promise<Array<Record<string, unknown>>> };
  stagingRecord: {
    findFirst: (a: unknown) => Promise<Record<string, unknown> | null>;
    create: (a: unknown) => Promise<unknown>;
    update: (a: unknown) => Promise<unknown>;
  };
};

export type ResumenPatrimonio = {
  objetivos: number;
  estimados: number;
  porConfianza: Record<string, number>;
  cambiados: number;
  puntajes: number;
  estimaciones: Estimacion[];
};

/** Los deals de Broward con senal de distress (confirmada o candidata), sin ruido. */
export async function objetivosDeBroward(prisma: PrismaPat, limite?: number): Promise<{ objetivos: Objetivo[]; carteraEnBase: Map<string, number> }> {
  const senales = await prisma.dealDistressSignal.findMany({
    where: { status: { in: ["CONFIRMED", "CANDIDATE"] }, deal: { isNoise: false, parcelId: { not: null }, OR: [{ source: "broward-parcels" }, { market: "Broward" }] } },
    select: { dealId: true, source: true, status: true, externalId: true, metadata: true, observedAt: true },
    orderBy: { observedAt: "desc" },
  });
  const porDeal = new Map<string, Array<Record<string, unknown>>>();
  for (const s of senales) porDeal.set(String(s.dealId), [...(porDeal.get(String(s.dealId)) ?? []), s]);
  let ids = [...porDeal.keys()].sort();
  if (limite && limite > 0) ids = ids.slice(0, limite);
  if (!ids.length) return { objetivos: [], carteraEnBase: new Map() };
  const deals = await prisma.deal.findMany({ where: { id: { in: ids } }, select: { id: true, parcelId: true } });
  const duenos = await prisma.dealOwner.findMany({ where: { dealId: { in: ids } }, select: { dealId: true, ownerId: true, owner: { select: { name: true } } } });
  const ownerIds = [...new Set(duenos.map((d) => String(d.ownerId)))];
  const otros = ownerIds.length
    ? await prisma.dealOwner.findMany({ where: { ownerId: { in: ownerIds } }, select: { dealId: true, ownerId: true } })
    : [];
  const dealsPorOwner = new Map<string, Set<string>>();
  for (const o of otros) dealsPorOwner.set(String(o.ownerId), (dealsPorOwner.get(String(o.ownerId)) ?? new Set()).add(String(o.dealId)));
  const carteraEnBase = new Map<string, number>();
  const objetivos: Objetivo[] = [];
  for (const d of deals) {
    const id = String(d.id);
    const mios = duenos.filter((x) => String(x.dealId) === id);
    const nombres = mios.map((x) => String((x.owner as { name?: string } | null)?.name ?? "")).filter(Boolean);
    carteraEnBase.set(id, Math.max(0, ...mios.map((x) => dealsPorOwner.get(String(x.ownerId))?.size ?? 0)));
    const sen = porDeal.get(id) ?? [];
    const delJuicio = sen.filter((s) => String(s.source ?? "").includes("foreclosure"));
    const confirmada = delJuicio.find((s) => s.status === "CONFIRMED") ?? delJuicio[0];
    objetivos.push({
      dealId: id,
      folio: String(d.parcelId ?? ""),
      duenos: nombres,
      casos: [...new Set(delJuicio.map((s) => String(s.externalId ?? "")).filter(Boolean))],
      demandante: confirmada ? demandanteDeSenal(confirmada.metadata as string | null) : null,
      hipotecasDelCaso: [...new Set(delJuicio.flatMap((s) => hipotecasDeLaSenal(s.metadata as string | null)))],
      bandaReclamo: confirmada ? leerCasoForeclosure(confirmada.metadata as string | null).banda : null,
      foliosDelCaso: [],
    });
  }
  // los folios que cada juicio toca en la base, tambien los de ruido (la franja de servidumbre de Team Smith)
  const casosTodos = [...new Set(objetivos.flatMap((o) => o.casos))];
  if (casosTodos.length) {
    const delCaso = await prisma.dealDistressSignal.findMany({
      where: { externalId: { in: casosTodos }, source: { contains: "foreclosure" } },
      select: { externalId: true, deal: { select: { parcelId: true } } },
    });
    const porCaso = new Map<string, Set<string>>();
    for (const s of delCaso) {
      const f = String((s.deal as { parcelId?: string | null } | null)?.parcelId ?? "");
      if (f) porCaso.set(String(s.externalId), (porCaso.get(String(s.externalId)) ?? new Set()).add(f.toUpperCase()));
    }
    for (const o of objetivos) o.foliosDelCaso = [...new Set(o.casos.flatMap((c) => [...(porCaso.get(c) ?? [])]))].sort();
  }
  return { objetivos, carteraEnBase };
}

export async function valoresDeTasacion(prisma: PrismaPat, ids: string[]): Promise<Map<string, number>> {
  const filas = await prisma.mdpaAssessment.findMany({
    where: { dealId: { in: ids }, justValue: { not: null } },
    select: { dealId: true, taxYear: true, justValue: true },
    orderBy: { taxYear: "desc" },
  });
  const m = new Map<string, number>();
  for (const f of filas) if (!m.has(String(f.dealId))) m.set(String(f.dealId), Number(f.justValue));
  return m;
}

export async function calcularPatrimonio(
  prisma: PrismaPat,
  opciones: {
    aplicar?: boolean;
    limite?: number;
    hoy?: Date;
    archivos?: ArchivoLocal[];
    lector?: Lector;
    recalcular?: (ids: string[]) => Promise<number>;
    log?: (m: string) => void;
  } = {},
): Promise<ResumenPatrimonio> {
  const log = opciones.log ?? (() => undefined);
  const hoy = opciones.hoy ?? new Date();
  const { objetivos, carteraEnBase } = await objetivosDeBroward(prisma, opciones.limite);
  const resumen: ResumenPatrimonio = { objetivos: objetivos.length, estimados: 0, porConfianza: {}, cambiados: 0, puntajes: 0, estimaciones: [] };
  if (!objetivos.length) return resumen;
  const archivos = opciones.archivos ?? (await archivosLocales());
  if (!archivos.some((a) => a.tipo === "nme") || !archivos.some((a) => a.tipo === "doc")) throw new Error("patrimonio: no hay indice del registro oficial en el Spark");
  log(`patrimonio: ${objetivos.length} deals, ${archivos.length} archivos del registro`);
  const ind = await cargarIndicePatrimonio(objetivos, archivos, opciones.lector);
  const valores = await valoresDeTasacion(prisma, objetivos.map((o) => o.dealId));
  const cambiados: string[] = [];
  const vals = objetivos.map((o) => valores.get(o.dealId) ?? null);
  const enBase = objetivos.map((o) => carteraEnBase.get(o.dealId) ?? 0);
  const porDeal = new Map<number, Estimacion>();
  for (const g of gruposPorCaso(objetivos)) {
    const comun = estimarGrupo(g, objetivos, ind, vals, hoy, enBase);
    for (const i of g) porDeal.set(i, { dealId: objetivos[i].dealId, folio: objetivos[i].folio.toUpperCase(), ...comun });
  }
  for (let i = 0; i < objetivos.length; i += 1) {
    const o = objetivos[i];
    const e = porDeal.get(i) as Estimacion;
    resumen.estimaciones.push(e);
    resumen.estimados += 1;
    resumen.porConfianza[e.confianza] = (resumen.porConfianza[e.confianza] ?? 0) + 1;
    if (!opciones.aplicar) continue;
    const payload = JSON.stringify(e);
    const previo = await prisma.stagingRecord.findFirst({ where: { source: FUENTE_PATRIMONIO, sourceRecordId: o.dealId }, select: { id: true } });
    if (previo) await prisma.stagingRecord.update({ where: { id: previo.id }, data: { payload, processedAt: hoy, status: "ESTIMADO" } });
    else await prisma.stagingRecord.create({ data: { source: FUENTE_PATRIMONIO, sourceRecordId: o.dealId, payload, status: "ESTIMADO", processedAt: hoy } });
    const [actual] = await prisma.deal.findMany({ where: { id: o.dealId }, select: { equityRatio: true, equityConfidence: true } });
    const ratio = e.ratio;
    if (actual && (actual.equityRatio !== ratio || actual.equityConfidence !== e.confianza)) {
      await prisma.deal.update({ where: { id: o.dealId }, data: { equityRatio: ratio, equityConfidence: e.confianza } });
      cambiados.push(o.dealId);
    }
  }
  resumen.cambiados = cambiados.length;
  if (opciones.aplicar && cambiados.length && opciones.recalcular) resumen.puntajes = await opciones.recalcular(cambiados);
  return resumen;
}
