import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { archivarVentana, dirRegistroDiario } from "./registro-diario-broward";
import type { OrigenRegistro } from "./registro-oficial-broward";

function origenFalso(archivos: Record<string, string>, leidos: string[]): OrigenRegistro {
  return {
    listar: async () => Object.keys(archivos).map((k) => k.split("/").pop() as string),
    leer: async (ruta) => {
      leidos.push(ruta);
      return archivos[ruta];
    },
    leerInicio: async () => "",
    recorrer: async () => undefined,
    cerrar: async () => undefined,
  };
}

describe("registro diario de Broward", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "diario-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const archivos = {
    "Official_Records_Download/11-04-2026doc-ver.txt": "121200001|11/04/2026|11/04/2026|101500|LP|0.00|||O|||||1|0|V||E|CACE-26-018000|\n",
    "Official_Records_Download/11-04-2026nme-ver.txt": "121200001|SOME BANK NA|D|1|\n",
    "Official_Records_Download/11-04-2026lnk-ver.txt": "",
    "Official_Records_Download/11-04-2026doc-img.zip": "no se baja",
    "Official_Records_Download/notas.txt": "tampoco",
  };

  it("baja solo los archivos de indice que faltan y no repite", async () => {
    const leidos: string[] = [];
    const r = await archivarVentana(origenFalso(archivos, leidos), dir);
    expect(r.enFtp).toBe(3);
    expect(r.bajados.sort()).toEqual(["11-04-2026doc-ver.txt", "11-04-2026lnk-ver.txt", "11-04-2026nme-ver.txt"]);
    expect(r.dias).toEqual(["2026-11-04"]);
    expect(readFileSync(join(dir, "11-04-2026doc-ver.txt"), "latin1")).toContain("CACE-26-018000");
    expect(readdirSync(dir).some((n) => n.endsWith(".part"))).toBe(false);

    // el lnk vacio se vuelve a pedir (sin datos), los otros dos ya estan
    const leidos2: string[] = [];
    const r2 = await archivarVentana(origenFalso(archivos, leidos2), dir);
    expect(r2.yaEstaban).toBe(2);
    expect(leidos2).toEqual(["Official_Records_Download/11-04-2026lnk-ver.txt"]);
  });

  it("no pisa un archivo que ya estaba con datos", async () => {
    writeFileSync(join(dir, "11-04-2026nme-ver.txt"), "local", "latin1");
    const leidos: string[] = [];
    await archivarVentana(origenFalso(archivos, leidos), dir);
    expect(readFileSync(join(dir, "11-04-2026nme-ver.txt"), "latin1")).toBe("local");
    expect(leidos).not.toContain("Official_Records_Download/11-04-2026nme-ver.txt");
  });

  it("el directorio sale de BROWARD_REGISTRO_DIARIO_DIR o del de siempre", () => {
    expect(dirRegistroDiario({ BROWARD_REGISTRO_DIARIO_DIR: "/x/y" })).toBe("/x/y");
    expect(dirRegistroDiario({})).toMatch(/broward-or\/diario$/);
  });
});
