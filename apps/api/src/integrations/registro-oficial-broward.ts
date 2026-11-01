import { createHash } from "crypto";
import { createReadStream, promises as fsp } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { Client, type SFTPWrapper } from "ssh2";
import { analizarDemandado, fuerzaCoincidencia, limpiarNombre, type Demandado } from "./broward-demandado";

/**
 * 31-oct-2026: folio de un expediente de foreclosure de Broward por el indice de Official Records.
 *
 * POR QUE: el expediente del Clerk trae la caratula, no el folio. El demandado se busca en el catastro por su
 * nombre (broward-demandado.ts) y entre 0 y 7 expedientes por dia no resuelven. El 31 oct se resolvieron 5 a mano,
 * con el navegador, por esta misma cadena: el lis pendens del caso enlaza la hipoteca que se ejecuta, esa hipoteca
 * se registro junto con la escritura de compra, y la escritura trae el folio. JR: "arranca" (estudio de remates
 * publicos del 31 oct, decision 1).
 *
 * FUENTE: el FTP publico del condado (SFTP en bcftp.broward.org:22). El usuario y la clave son PUBLICOS: los publica
 * el condado en broward.org (Records, "Bulk Data Files"). Tiene 10 dias de indice e imagenes y las exportaciones
 * anuales desde 1978. Gratis, sin captcha y sin terminos aparte del acceso. Solo se leen los archivos de indice;
 * nunca las imagenes (de 300 a 400 MB por dia). La clave del servidor se fija por su huella SHA256.
 *
 * LA CADENA, medida en el archivo del 29 oct: el lis pendens trae el caso, el demandante (lado D) y los demandados
 * (lado R), pero no el folio. Si enlaza una hipoteca (tipo M), se busca esa hipoteca en el indice (la ventana diaria
 * o la exportacion del anio); su deudor (lado D) tiene que ser uno de los demandados; y la escritura es el
 * instrumento anterior mas cercano del mismo dia y la misma tanda (hasta 3 antes, sin otra hipoteca en el medio).
 * Ejemplo real: lis pendens 121179930 (CACE-26-017727) -> hipoteca 110618960 de 2012 -> escritura 110618959 ->
 * folio 504206200430.
 */

export const HOST_REGISTRO = "bcftp.broward.org";
export const PUERTO_REGISTRO = 22;
/** Usuario y clave publicos, publicados por el condado en broward.org. No son secretos. */
export const USUARIO_PUBLICO = "crpublic";
/**
 * Huella SHA256 de la clave RSA del servidor, tomada el 31-oct-2026 con ssh-keyscan desde el Spark. Si el condado la
 * cambia, la conexion se corta y la corrida lo dice: hay que verificar la nueva antes de reemplazarla aca.
 */
export const HUELLA_SERVIDOR = "4wdRNzVLM0McmLwKxo+3W3HIpb8Y+PsUiyfFYC/QI5U";
export const DIR_DIARIO = "Official_Records_Download";
export const DIR_ANUAL = "OR_Yearly_Exports";
export const PLAZO_CONEXION_MS = 20_000;
export const PLAZO_OPERACION_MS = 180_000;
/** Exportaciones anuales a recorrer por corrida (cada una, unos 60 MB de documentos y otros tantos de nombres). */
export const MAX_ANIOS_POR_CORRIDA = 6;
/** La escritura va hasta 3 instrumentos antes de la hipoteca, el mismo dia y a menos de 5 minutos. */
export const MAX_SALTO_ESCRITURA = 3;
export const MAX_SEGUNDOS_ESCRITURA = 300;
/** Como en el catastro: un expediente puede caer en unos pocos folios del mismo dueño, no en mas. */
export const MAX_FOLIOS_POR_CASO = 3;
const TIPOS_HIPOTECA = new Set(["M"]);
/** Folio de Broward: 12 caracteres (los condominios llevan letras, por ejemplo 494105DA0270). */
const RE_FOLIO = /^[0-9A-Z]{12}$/;

export type DocumentoOR = {
  instrumento: string;
  fecha: string;
  hora: string;
  tipo: string;
  monto: number;
  libro: string;
  pagina: string;
  folio: string;
  caso: string;
};
export type ParteOR = { instrumento: string; nombre: string; lado: string };
export type EnlaceOR = { instrumento: string; destino: string; tipoDestino: string; libro: string; pagina: string };

export type EstadoCadena =
  | "CADENA"
  | "SIN_LIS_PENDENS"
  | "SIN_HIPOTECA_ENLAZADA"
  | "HIPOTECA_NO_ENCONTRADA"
  | "DEUDOR_NO_COINCIDE"
  | "SIN_ESCRITURA"
  | "VARIOS_FOLIOS";
export type ResultadoCadena = { estado: EstadoCadena; folios: string[]; motivo: string };
export type CasoBuscado = { caso: string; demandado?: string | null };

/** Lo que el conector necesita del FTP. La implementacion real es abrirOrigenBroward; los tests usan una falsa. */
export interface OrigenRegistro {
  listar(dir: string): Promise<string[]>;
  leer(ruta: string): Promise<string>;
  leerInicio(ruta: string, bytes: number): Promise<string>;
  recorrer(ruta: string, porLinea: (linea: string) => void): Promise<void>;
  cerrar(): Promise<void>;
}

/** BROWARD_REGISTRO_OFICIAL=off lo apaga sin desplegar codigo. Cualquier otro valor, o ninguno, lo deja prendido. */
export function registroOficialActivo(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.BROWARD_REGISTRO_OFICIAL ?? "").trim().toLowerCase() !== "off";
}

// Algunas exportaciones anuales empiezan con la marca de orden de bytes; leidas en latin1 se ve como "\u00EF\u00BB\u00BF".
const BOM = /^(\uFEFF|\u00EF\u00BB\u00BF)/;
const campos = (linea: string) => linea.replace(BOM, "").replace(/\r$/, "").split("|");
const soloDigitos = (s: string | undefined) => /^\d+$/.test(s ?? "");

export const normalizarCaso = (caso: string | null | undefined) => String(caso ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function leerDocumento(f: string[]): DocumentoOR | null {
  if (f.length < 11 || !soloDigitos(f[0])) return null;
  return {
    instrumento: f[0],
    fecha: (f[1] ?? "").trim(),
    hora: (f[3] ?? "").trim(),
    tipo: (f[4] ?? "").trim().toUpperCase(),
    monto: Number(f[5]) || 0,
    libro: (f[6] ?? "").trim(),
    pagina: (f[7] ?? "").trim(),
    folio: (f[10] ?? "").trim().toUpperCase(),
    caso: (f[18] ?? "").trim(),
  };
}

export function leerParte(f: string[]): ParteOR | null {
  if (f.length < 3 || !soloDigitos(f[0]) || !(f[1] ?? "").trim()) return null;
  return { instrumento: f[0], nombre: f[1].trim(), lado: (f[2] ?? "").trim().toUpperCase() };
}

export function leerEnlace(f: string[]): EnlaceOR | null {
  if (f.length < 10 || !soloDigitos(f[0]) || !soloDigitos(f[5])) return null;
  return {
    instrumento: f[0],
    destino: f[5],
    libro: (f[6] ?? "").trim(),
    pagina: (f[7] ?? "").trim(),
    tipoDestino: (f[9] ?? "").trim().toUpperCase(),
  };
}

/** Un nombre del indice ("APELLIDO,NOMBRE MEDIO" o una empresa) en la forma que compara broward-demandado. */
export function nombreComoDemandado(nombre: string): Demandado | null {
  const d = analizarDemandado(nombre);
  if (!d || d.tipo === "EMPRESA") return d;
  const limpio = limpiarNombre(nombre);
  const coma = limpio.indexOf(",");
  if (coma <= 0) return d;
  const apellido = limpio.slice(0, coma).trim();
  const resto = limpio.slice(coma + 1).trim().split(" ").filter(Boolean);
  if (!apellido || !resto.length) return null;
  return { tipo: "PERSONA", nombre: resto[0], medios: resto.slice(1), apellido, apellidoCompuesto: null };
}

const vecino = (inst: string, k: number) => String(Number(inst) - k).padStart(inst.length, "0");

function segundos(hora: string): number | null {
  if (!/^\d{6}$/.test(hora)) return null;
  return Number(hora.slice(0, 2)) * 3600 + Number(hora.slice(2, 4)) * 60 + Number(hora.slice(4, 6));
}

/** El indice guarda la hora en 12 horas sin AM/PM: la diferencia se mide modulo 12 horas. */
function mismaTanda(a: string, b: string): boolean {
  const x = segundos(a);
  const y = segundos(b);
  if (x === null || y === null) return false;
  const d = Math.abs(x - y) % 43200;
  return Math.min(d, 43200 - d) <= MAX_SEGUNDOS_ESCRITURA;
}

/**
 * La escritura que se registro con la hipoteca: la anterior mas cercana, hasta 3 instrumentos antes, el mismo dia
 * y en la misma tanda, con folio. Otra hipoteca en el medio es otro cierre: corta. Un refinanciamiento no tiene
 * escritura al lado y no resuelve (queda en la lista sin folio).
 */
export function escrituraDeLaHipoteca(hipoteca: DocumentoOR, docs: Map<string, DocumentoOR>): DocumentoOR | null {
  for (let k = 1; k <= MAX_SALTO_ESCRITURA; k += 1) {
    const d = docs.get(vecino(hipoteca.instrumento, k));
    if (!d) continue;
    if (d.fecha !== hipoteca.fecha || !mismaTanda(d.hora, hipoteca.hora)) return null;
    if (TIPOS_HIPOTECA.has(d.tipo)) return null;
    if (d.tipo === "D" && RE_FOLIO.test(d.folio)) return d;
  }
  return null;
}

export type Indice = {
  docs: Map<string, DocumentoOR>;
  partes: Map<string, ParteOR[]>;
  enlaces: Map<string, EnlaceOR[]>;
  lisPendens: Map<string, DocumentoOR[]>;
  dias: string[];
};

export const indiceVacio = (): Indice => ({
  docs: new Map(),
  partes: new Map(),
  enlaces: new Map(),
  lisPendens: new Map(),
  dias: [],
});

function sumar<T>(mapa: Map<string, T[]>, clave: string, valor: T) {
  const lista = mapa.get(clave);
  if (lista) lista.push(valor);
  else mapa.set(clave, [valor]);
}

export function agregarDocumento(ind: Indice, d: DocumentoOR) {
  ind.docs.set(d.instrumento, d);
  if (d.tipo === "LP" && d.caso) sumar(ind.lisPendens, normalizarCaso(d.caso), d);
}

/** Suma al indice un archivo de la ventana diaria: doc, nme o lnk. */
export function agregarArchivo(ind: Indice, tipo: "doc" | "nme" | "lnk", texto: string) {
  for (const linea of texto.split("\n")) {
    if (!linea.trim()) continue;
    const f = campos(linea);
    if (tipo === "doc") {
      const d = leerDocumento(f);
      if (d) agregarDocumento(ind, d);
    } else if (tipo === "nme") {
      const p = leerParte(f);
      if (p) sumar(ind.partes, p.instrumento, p);
    } else {
      const e = leerEnlace(f);
      if (e) sumar(ind.enlaces, e.instrumento, e);
    }
  }
}

const RE_DIARIO = /^(\d{2})-(\d{2})-(\d{4})(doc|nme|lnk)-ver\.txt$/i;

/** Los 10 dias del FTP: documentos, nombres y enlaces. Unos 500 KB por dia, sin las imagenes. */
export async function cargarVentana(origen: OrigenRegistro): Promise<Indice> {
  const ind = indiceVacio();
  const dias = new Set<string>();
  for (const nombre of (await origen.listar(DIR_DIARIO)).sort()) {
    const m = RE_DIARIO.exec(nombre);
    if (!m) continue;
    dias.add(`${m[3]}-${m[1]}-${m[2]}`);
    agregarArchivo(ind, m[4].toLowerCase() as "doc" | "nme" | "lnk", await origen.leer(`${DIR_DIARIO}/${nombre}`));
  }
  ind.dias = [...dias].sort();
  return ind;
}

export type RangoAnual = { anio: string; desde: number };

/** El primer instrumento de cada exportacion anual. Desde 1978 crecen con el anio. */
export async function rangosAnuales(origen: OrigenRegistro): Promise<RangoAnual[]> {
  const anios = (await origen.listar(DIR_ANUAL))
    .map((n) => /^CY(\d{4})doc-rec\.txt$/i.exec(n)?.[1])
    .filter((a): a is string => Boolean(a))
    .sort();
  const rangos: RangoAnual[] = [];
  for (const anio of anios) {
    const primero = campos((await origen.leerInicio(`${DIR_ANUAL}/CY${anio}doc-rec.txt`, 200)).split("\n")[0])[0];
    if (soloDigitos(primero)) rangos.push({ anio, desde: Number(primero) });
  }
  return rangos.sort((a, b) => a.desde - b.desde);
}

export function anioDelInstrumento(instrumento: string, rangos: RangoAnual[]): string | null {
  const n = Number(instrumento);
  let anio: string | null = null;
  for (const r of rangos) if (r.desde <= n) anio = r.anio;
  return anio;
}

const primerCampo = (linea: string) => {
  const i = linea.indexOf("|");
  return (i < 0 ? linea : linea.slice(0, i)).replace(BOM, "");
};

/** Recorre la exportacion de un anio y suma al indice solo los instrumentos buscados, con sus nombres. */
export async function buscarEnAnio(origen: OrigenRegistro, anio: string, buscados: Set<string>, ind: Indice) {
  await origen.recorrer(`${DIR_ANUAL}/CY${anio}doc-rec.txt`, (linea) => {
    if (!buscados.has(primerCampo(linea))) return;
    const d = leerDocumento(campos(linea));
    if (d) agregarDocumento(ind, d);
  });
  await origen.recorrer(`${DIR_ANUAL}/CY${anio}nme-rec.txt`, (linea) => {
    if (!buscados.has(primerCampo(linea))) return;
    const p = leerParte(campos(linea));
    if (p) sumar(ind.partes, p.instrumento, p);
  });
}

const PRIORIDAD: EstadoCadena[] = ["DEUDOR_NO_COINCIDE", "SIN_ESCRITURA", "HIPOTECA_NO_ENCONTRADA"];

/**
 * Evalua la cadena de cada caso sobre un indice ya cargado. Pura: la usan resolverCadenas y los tests.
 * Devuelve tambien las hipotecas que faltan en el indice, para buscarlas en las exportaciones anuales.
 */
export function evaluarCadenas(casos: CasoBuscado[], ind: Indice): {
  resultados: Map<string, ResultadoCadena>;
  hipotecasFaltantes: Set<string>;
} {
  const resultados = new Map<string, ResultadoCadena>();
  const hipotecasFaltantes = new Set<string>();
  const ventana = ind.dias.length ? `${ind.dias[0]} a ${ind.dias[ind.dias.length - 1]}` : "sin dias";

  for (const c of casos) {
    const caso = normalizarCaso(c.caso);
    if (!caso || resultados.has(caso)) continue;
    const lps = ind.lisPendens.get(caso) ?? [];
    if (!lps.length) {
      resultados.set(caso, { estado: "SIN_LIS_PENDENS", folios: [], motivo: `sin lis pendens del caso en el FTP (${ventana})` });
      continue;
    }
    const demandados: Demandado[] = [];
    for (const lp of lps) {
      for (const p of ind.partes.get(lp.instrumento) ?? []) {
        if (p.lado !== "R") continue;
        const d = nombreComoDemandado(p.nombre);
        if (d) demandados.push(d);
      }
    }
    const delExpediente = c.demandado ? analizarDemandado(c.demandado) : null;
    if (delExpediente) demandados.push(delExpediente);

    const hipotecas = [
      ...new Set(
        lps.flatMap((lp) =>
          (ind.enlaces.get(lp.instrumento) ?? []).filter((e) => TIPOS_HIPOTECA.has(e.tipoDestino)).map((e) => e.destino),
        ),
      ),
    ];
    const lpTxt = lps.map((lp) => lp.instrumento).join(", ");
    if (!hipotecas.length) {
      resultados.set(caso, { estado: "SIN_HIPOTECA_ENLAZADA", folios: [], motivo: `lis pendens ${lpTxt} sin hipoteca enlazada` });
      continue;
    }

    const folios = new Set<string>();
    const pasos: string[] = [];
    const fallas: Array<{ estado: EstadoCadena; motivo: string }> = [];
    for (const h of hipotecas) {
      const hip = ind.docs.get(h);
      if (!hip || !TIPOS_HIPOTECA.has(hip.tipo)) {
        hipotecasFaltantes.add(h);
        fallas.push({ estado: "HIPOTECA_NO_ENCONTRADA", motivo: `hipoteca ${h} no esta en el indice leido` });
        continue;
      }
      const deudor = (ind.partes.get(h) ?? [])
        .filter((p) => p.lado === "D")
        .map((p) => p.nombre)
        .find((n) => demandados.some((d) => fuerzaCoincidencia(d, n) > 0));
      if (!deudor) {
        fallas.push({ estado: "DEUDOR_NO_COINCIDE", motivo: `el deudor de la hipoteca ${h} no es un demandado` });
        continue;
      }
      const escritura = escrituraDeLaHipoteca(hip, ind.docs);
      if (!escritura) {
        fallas.push({ estado: "SIN_ESCRITURA", motivo: `sin escritura con folio registrada junto con la hipoteca ${h}` });
        continue;
      }
      folios.add(escritura.folio);
      pasos.push(
        `lis pendens ${lpTxt} -> hipoteca ${h} (${hip.fecha}, deudor ${deudor}) -> escritura ${escritura.instrumento} -> folio ${escritura.folio}`,
      );
    }

    if (folios.size && folios.size <= MAX_FOLIOS_POR_CASO) {
      resultados.set(caso, { estado: "CADENA", folios: [...folios], motivo: pasos.join("; ") });
    } else if (folios.size) {
      resultados.set(caso, { estado: "VARIOS_FOLIOS", folios: [], motivo: `${folios.size} folios distintos: ${[...folios].join(", ")}` });
    } else {
      const estado = PRIORIDAD.find((e) => fallas.some((f) => f.estado === e)) ?? "HIPOTECA_NO_ENCONTRADA";
      resultados.set(caso, { estado, folios: [], motivo: fallas.map((f) => f.motivo).join("; ") });
    }
  }
  return { resultados, hipotecasFaltantes };
}

/**
 * La cadena completa: carga la ventana diaria, evalua, busca en las exportaciones anuales las hipotecas que faltan
 * (las mas recientes primero, hasta MAX_ANIOS_POR_CORRIDA) y vuelve a evaluar.
 */
export async function resolverCadenas(casos: CasoBuscado[], origen: OrigenRegistro): Promise<Map<string, ResultadoCadena>> {
  const ind = await cargarVentana(origen);
  const primera = evaluarCadenas(casos, ind);
  if (!primera.hipotecasFaltantes.size) return primera.resultados;

  const rangos = await rangosAnuales(origen);
  const porAnio = new Map<string, Set<string>>();
  for (const h of primera.hipotecasFaltantes) {
    const anio = anioDelInstrumento(h, rangos);
    if (!anio) continue;
    const buscados = porAnio.get(anio) ?? new Set<string>();
    for (let k = 0; k <= MAX_SALTO_ESCRITURA; k += 1) buscados.add(vecino(h, k));
    porAnio.set(anio, buscados);
  }
  const anios = [...porAnio.keys()].sort().reverse().slice(0, MAX_ANIOS_POR_CORRIDA);
  for (const anio of anios) await buscarEnAnio(origen, anio, porAnio.get(anio) as Set<string>, ind);
  return evaluarCadenas(casos, ind).resultados;
}

export const huellaDeClave = (clave: Buffer) => createHash("sha256").update(clave).digest("base64").replace(/=+$/, "");

function conPlazo<T>(promesa: Promise<T>, ms: number, que: string): Promise<T> {
  let corte: NodeJS.Timeout | undefined;
  const plazo = new Promise<never>((_, mal) => {
    corte = setTimeout(() => mal(new Error(`FTP de Official Records: ${que} sin respuesta en ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([promesa, plazo]).finally(() => clearTimeout(corte));
}

/** Abre el FTP del condado. Cerrar siempre con cerrar(), tambien si algo falla. */
export async function abrirOrigenBroward(plazoMs = PLAZO_OPERACION_MS): Promise<OrigenRegistro> {
  const cliente = new Client();
  const sftp = await conPlazo(
    new Promise<SFTPWrapper>((ok, mal) => {
      cliente.on("ready", () => cliente.sftp((e, s) => (e ? mal(e) : ok(s))));
      cliente.on("error", (e: Error) =>
        mal(/verification failed/i.test(e.message) ? new Error("FTP de Official Records: la huella del servidor no coincide") : e),
      );
      cliente.connect({
        host: HOST_REGISTRO,
        port: PUERTO_REGISTRO,
        username: USUARIO_PUBLICO,
        password: USUARIO_PUBLICO,
        readyTimeout: PLAZO_CONEXION_MS,
        hostVerifier: (clave: Buffer) => huellaDeClave(clave) === HUELLA_SERVIDOR,
      });
    }),
    PLAZO_CONEXION_MS + 5_000,
    "la conexion",
  ).catch((e) => {
    cliente.end();
    throw e;
  });

  const dirTmp = await fsp.mkdtemp(join(tmpdir(), "registro-oficial-"));
  return {
    listar: (dir) =>
      conPlazo(
        new Promise<string[]>((ok, mal) => sftp.readdir(dir, (e, lista) => (e ? mal(e) : ok(lista.map((x) => x.filename))))),
        plazoMs,
        `listar ${dir}`,
      ),
    leer: (ruta) =>
      conPlazo(
        new Promise<string>((ok, mal) => sftp.readFile(ruta, (e, b) => (e ? mal(e) : ok(Buffer.from(b).toString("latin1"))))),
        plazoMs,
        `leer ${ruta}`,
      ),
    leerInicio: (ruta, bytes) =>
      conPlazo(
        new Promise<string>((ok, mal) =>
          sftp.open(ruta, "r", (e, h) => {
            if (e) return mal(e);
            const buf = Buffer.alloc(bytes);
            sftp.read(h, buf, 0, bytes, 0, (e2, leidos) => {
              sftp.close(h, () => (e2 ? mal(e2) : ok(buf.subarray(0, leidos).toString("latin1"))));
            });
          }),
        ),
        plazoMs,
        `leer el inicio de ${ruta}`,
      ),
    // Las exportaciones anuales pesan de 30 a 90 MB: se bajan en paralelo a un temporal, se leen y se borran.
    recorrer: async (ruta, porLinea) => {
      const local = join(dirTmp, basename(ruta));
      try {
        await conPlazo(
          new Promise<void>((ok, mal) => sftp.fastGet(ruta, local, { concurrency: 32, chunkSize: 32768 }, (e) => (e ? mal(e) : ok()))),
          plazoMs,
          `bajar ${ruta}`,
        );
        await new Promise<void>((ok, mal) => {
          let resto = "";
          createReadStream(local)
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
      } finally {
        await fsp.rm(local, { force: true });
      }
    },
    cerrar: async () => {
      cliente.end();
      await fsp.rm(dirTmp, { recursive: true, force: true });
    },
  };
}
