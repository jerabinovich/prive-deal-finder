import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  claveConsulta,
  guardarCursor,
  leerCursor,
  posicionDe,
  siguienteCursor,
  whereBroward,
  whereMiamiDade,
  zipsDeCorredores,
} from "./parcelas-corredores";

function buybox(contenido: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "buybox-"));
  const ruta = join(dir, "buybox.json");
  writeFileSync(ruta, JSON.stringify(contenido));
  return ruta;
}

describe("sync de parcelas por corredores", () => {
  it("toma los zips de Florida de los corredores de buybox.json, sin repetir", () => {
    const ruta = buybox({
      corredores_tier1: {
        _fuente: "texto",
        Brickell: { zips: ["33131", "33130"] },
        "Upper East Side": { zips: ["10021"] },
        Charlotte: { zips: ["28207"] },
        "Las Olas": { zips: ["33301", "33131"] },
      },
    });
    expect(zipsDeCorredores(ruta)).toEqual(["33130", "33131", "33301"]);
  });

  it("sin corredores de Florida falla con el motivo, no vuelve a la muestra ciega", () => {
    expect(() => zipsDeCorredores(buybox({ corredores_tier1: { NY: { zips: ["10021"] } } }))).toThrow(/sin zips/);
  });

  it("Miami-Dade: zips por prefijo y usos del buy box, sin el folio de referencia", () => {
    const w = whereMiamiDade(["33131", "33139"]);
    expect(w).toContain("TRUE_SITE_ZIP_CODE LIKE '33131%' OR TRUE_SITE_ZIP_CODE LIKE '33139%'");
    expect(w).toContain("DOR_CODE_CUR <> '0000'");
    expect(w).toContain("DOR_CODE_CUR LIKE '03%'");
    expect(w).toContain("DOR_CODE_CUR >= '1000' AND DOR_CODE_CUR < '5000'");
    expect(w).not.toContain("'01");
  });

  it("Broward: zips por prefijo (hay de 9 digitos) y USE_CODE del buy box", () => {
    const w = whereBroward(["33301"]);
    expect(w).toContain("SITUS_ZIP_CODE LIKE '33301%'");
    expect(w).toContain("USE_CODE IN ('00','03','08','80','86','87','88','89')");
    expect(w).toContain("USE_CODE >= '10' AND USE_CODE <= '49'");
  });

  it("el cursor avanza, vuelve al principio al final y empieza de cero si cambia la consulta", () => {
    const clave = claveConsulta("https://capa/72", "w");
    expect(claveConsulta("https://capa/72", "w")).toBe(clave);
    expect(claveConsulta("https://capa/72", "otro")).not.toBe(clave);
    expect(siguienteCursor(clave, 400, 2, 200, 200)).toMatchObject({ clave, offset: 600, vueltas: 2 });
    expect(siguienteCursor(clave, 600, 2, 37, 200)).toMatchObject({ clave, offset: 0, vueltas: 3 });
    expect(posicionDe({ clave, offset: 600, vueltas: 2 }, clave)).toEqual({ offset: 600, vueltas: 2 });
    expect(posicionDe({ clave: "vieja", offset: 600, vueltas: 2 }, clave)).toEqual({ offset: 0, vueltas: 0 });
    expect(posicionDe(null, clave)).toEqual({ offset: 0, vueltas: 0 });
  });

  it("el cursor vive en Integration.meta sin pisar lo demas", async () => {
    let meta: string | null = JSON.stringify({ otra: 1 });
    const prisma = {
      integration: {
        findUnique: jest.fn(async () => ({ meta })),
        upsert: jest.fn(async (args: { update: { meta: string } }) => {
          meta = args.update.meta;
          return {};
        }),
      },
    };
    expect(await leerCursor(prisma as never, "broward-parcels")).toBeNull();
    await guardarCursor(prisma as never, "broward-parcels", { clave: "k", offset: 200, vueltas: 0 });
    expect(JSON.parse(meta as string)).toEqual({ otra: 1, cursorParcelas: { clave: "k", offset: 200, vueltas: 0 } });
    expect(await leerCursor(prisma as never, "broward-parcels")).toEqual({ clave: "k", offset: 200, vueltas: 0 });
  });
});
