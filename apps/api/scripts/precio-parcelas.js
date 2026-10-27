/**
 * Parcelas sin precio pedido (src/integrations/precio-parcelas.ts, 25-oct-2026, decision de JR).
 *
 * Uso, desde apps/api, despues del build y con el .env cargado:
 *   node scripts/precio-parcelas.js                                  prueba: cuenta y resume, no escribe
 *   node scripts/precio-parcelas.js --aplicar --respaldo ARCHIVO     guarda antes y despues de cada deal en ARCHIVO
 *                                                                   (no puede existir); anota cada fila en
 *                                                                   ARCHIVO.aplicados ANTES de escribirla
 *   node scripts/precio-parcelas.js --restaurar ARCHIVO              vuelve a los valores de antes, solo en las filas
 *                                                                   anotadas en ARCHIVO.aplicados (se puede retomar)
 *   --fuente X                                                       solo esa fuente (se puede repetir)
 */
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const { filasARestaurar, leerArgumentos } = require("../dist/integrations/recalculo-unico");
const { aplicarPrecio, planearPrecio, restaurarPrecio, resumenPrecio, vigentePrecio } = require("../dist/integrations/precio-parcelas");

const log = (...m) => console.log(new Date().toISOString(), ...m);

async function main() {
  const op = leerArgumentos(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    if (op.restaurar) {
      const { cambios } = JSON.parse(fs.readFileSync(op.restaurar, "utf-8"));
      const aplicados = filasARestaurar(fs.readFileSync(`${op.restaurar}.aplicados`, "utf-8").split("\n"));
      const rutaRest = `${op.restaurar}.restaurados`;
      const yaRestaurados = fs.existsSync(rutaRest) ? fs.readFileSync(rutaRest, "utf-8").split("\n").filter(Boolean) : [];
      const reg = fs.openSync(rutaRest, "a", 0o600);
      try {
        const r = await restaurarPrecio(prisma, cambios, aplicados, {
          yaRestaurados,
          alRestaurar: (id) => { fs.writeSync(reg, `${id}\n`); fs.fsyncSync(reg); },
        });
        log("restaurado", JSON.stringify(r), "de", aplicados.length, "aplicados;", yaRestaurados.length, "ya restaurados antes");
      } finally {
        fs.closeSync(reg);
      }
      return;
    }
    const cambios = await planearPrecio(prisma, op.fuentes);
    log("plan", JSON.stringify(resumenPrecio(cambios)));
    if (!op.aplicar) {
      log("prueba (sin escribir)");
      return;
    }
    if (!op.respaldo) throw new Error("--aplicar necesita --respaldo ARCHIVO (sin respaldo no se escribe nada)");
    fs.writeFileSync(op.respaldo, JSON.stringify({ creado: new Date().toISOString(), fuentes: op.fuentes, cambios }), { flag: "wx", mode: 0o600 });
    const registro = fs.openSync(`${op.respaldo}.aplicados`, "wx", 0o600);
    log("respaldo", op.respaldo, cambios.length, "deals");
    try {
      log("aplicado", JSON.stringify(await aplicarPrecio(prisma, cambios, {
        vigente: (id) => vigentePrecio(prisma, id),
        antes: (id) => { fs.writeSync(registro, `intento ${id}\n`); fs.fsyncSync(registro); },
        salteado: (id) => fs.writeSync(registro, `salteado ${id}\n`),
      })));
    } finally {
      fs.closeSync(registro);
    }
    log("quedan distintos", (await planearPrecio(prisma, op.fuentes)).length);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(new Date().toISOString(), "error:", e && e.message ? e.message : e);
  process.exit(1);
});
