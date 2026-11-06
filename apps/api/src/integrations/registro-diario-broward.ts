import { promises as fsp } from "fs";
import { homedir } from "os";
import { join } from "path";
import { DIR_DIARIO, type OrigenRegistro } from "./registro-oficial-broward";

/**
 * 6-nov-2026 (JR: "haz el 1, 2 y 3", punto 3): archivo propio de la ventana diaria del registro oficial de Broward.
 *
 * POR QUE: el FTP del condado tiene 10 dias moviles (Official_Records_Download) y las exportaciones anuales hasta el
 * ultimo anio cerrado. Lo registrado en el anio en curso desaparece del FTP a los 10 dias y no vuelve hasta la
 * exportacion del anio siguiente. Sin un archivo propio, una compra o una hipoteca de 2026 no se ve (medido el 6-nov:
 * el dueno de 6546 NW 24 Ct, Margate, no aparece en 2005 a 2025 porque compro en 2026).
 *
 * QUE HACE: baja los archivos de indice del dia (doc, nme y lnk; nunca las imagenes) que todavia no estan en el
 * directorio local, a un .part y despues renombra. Repetible sin efecto. Unos 500 KB por dia.
 */
export const RE_ARCHIVO_DIARIO = /^(\d{2})-(\d{2})-(\d{4})(doc|nme|lnk)-ver\.txt$/i;

export function dirRegistroDiario(env: NodeJS.ProcessEnv = process.env): string {
  const v = String(env.BROWARD_REGISTRO_DIARIO_DIR ?? "").trim();
  return v || join(homedir(), "broward-or", "diario");
}

export type ResumenArchivo = { enFtp: number; bajados: string[]; yaEstaban: number; dias: string[] };

async function existeConDatos(ruta: string): Promise<boolean> {
  try {
    return (await fsp.stat(ruta)).size > 0;
  } catch {
    return false;
  }
}

/** Baja al directorio local los archivos de indice de la ventana que faltan. */
export async function archivarVentana(origen: OrigenRegistro, dir: string): Promise<ResumenArchivo> {
  await fsp.mkdir(dir, { recursive: true });
  const nombres = (await origen.listar(DIR_DIARIO)).filter((n) => RE_ARCHIVO_DIARIO.test(n)).sort();
  const dias = new Set<string>();
  const bajados: string[] = [];
  let yaEstaban = 0;
  for (const nombre of nombres) {
    const m = RE_ARCHIVO_DIARIO.exec(nombre);
    if (m) dias.add(`${m[3]}-${m[1]}-${m[2]}`);
    const destino = join(dir, nombre);
    if (await existeConDatos(destino)) {
      yaEstaban += 1;
      continue;
    }
    const texto = await origen.leer(`${DIR_DIARIO}/${nombre}`);
    await fsp.writeFile(`${destino}.part`, texto, "latin1");
    await fsp.rename(`${destino}.part`, destino);
    bajados.push(nombre);
  }
  return { enFtp: nombres.length, bajados, yaEstaban, dias: [...dias].sort() };
}
