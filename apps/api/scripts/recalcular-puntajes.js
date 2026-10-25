/**
 * Recalculo unico de scores (src/integrations/recalculo-unico.ts, 25-oct-2026, OK de JR).
 *
 * Uso, desde apps/api, despues del build y con el .env cargado:
 *   node scripts/recalcular-puntajes.js                                  prueba: cuenta y resume, no escribe
 *   node scripts/recalcular-puntajes.js --aplicar --respaldo ARCHIVO     guarda antes y despues de cada deal en ARCHIVO
 *                                                                       (no puede existir); anota cada fila en
 *                                                                       ARCHIVO.aplicados ANTES de escribirla
 *   node scripts/recalcular-puntajes.js --restaurar ARCHIVO              vuelve a los valores de antes, solo en las filas
 *                                                                       anotadas en ARCHIVO.aplicados
 *   --fuente X                                                           solo esa fuente (se puede repetir)
 */
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const { aplicar, filasARestaurar, leerArgumentos, planear, restaurar } = require("../dist/integrations/recalculo-unico");

const log = (...m) => console.log(new Date().toISOString(), ...m);

function resumen(cambios) {
  const diferencias = {};
  let cruzan40 = 0;
  for (const c of cambios) {
    const d = (c.despues.score ?? 0) - (c.antes.score ?? 0);
    diferencias[d] = (diferencias[d] || 0) + 1;
    if ((c.antes.score ?? 0) < 40 && (c.despues.score ?? 0) >= 40) cruzan40 += 1;
  }
  return { cambios: cambios.length, diferencias, cruzanUmbral40: cruzan40 };
}

async function main() {
  const op = leerArgumentos(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    if (op.restaurar) {
      const { cambios } = JSON.parse(fs.readFileSync(op.restaurar, "utf-8"));
      const aplicados = filasARestaurar(fs.readFileSync(`${op.restaurar}.aplicados`, "utf-8").split("\n"));
      log("restaurado", JSON.stringify(await restaurar(prisma, cambios, aplicados)), "de", aplicados.length, "aplicados");
      return;
    }
    const cambios = await planear(prisma, op.fuentes);
    log("plan", JSON.stringify(resumen(cambios)));
    if (!op.aplicar) {
      log("prueba (sin escribir)");
      return;
    }
    if (!op.respaldo) throw new Error("--aplicar necesita --respaldo ARCHIVO (sin respaldo no se escribe nada)");
    fs.writeFileSync(op.respaldo, JSON.stringify({ creado: new Date().toISOString(), fuentes: op.fuentes, cambios }), { flag: "wx", mode: 0o600 });
    const registro = fs.openSync(`${op.respaldo}.aplicados`, "wx", 0o600);
    log("respaldo", op.respaldo, cambios.length, "deals");
    try {
      log("aplicado", JSON.stringify(await aplicar(prisma, cambios, {
        antes: (id) => { fs.writeSync(registro, `intento ${id}\n`); fs.fsyncSync(registro); },
        salteado: (id) => fs.writeSync(registro, `salteado ${id}\n`),
      })));
    } finally {
      fs.closeSync(registro);
    }
    log("quedan distintos", (await planear(prisma, op.fuentes)).length);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(new Date().toISOString(), "error:", e && e.message ? e.message : e);
  process.exit(1);
});
