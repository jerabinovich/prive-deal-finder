/**
 * Recalculo unico de scores (src/integrations/recalculo-unico.ts, 25-oct-2026, OK de JR).
 *
 * Uso, desde apps/api, despues del build y con el .env cargado:
 *   node scripts/recalcular-puntajes.js                                  prueba: cuenta y resume, no escribe
 *   node scripts/recalcular-puntajes.js --aplicar --respaldo ARCHIVO     guarda antes y despues de cada deal en ARCHIVO
 *                                                                       (no puede existir) y recien despues escribe
 *   node scripts/recalcular-puntajes.js --restaurar ARCHIVO              vuelve a los valores de antes desde el respaldo
 *   --fuente X                                                           solo esa fuente (se puede repetir)
 */
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const { aplicar, planear, restaurar } = require("../dist/integrations/recalculo-unico");

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
  const args = process.argv.slice(2);
  const valor = (op) => {
    const i = args.indexOf(op);
    if (i < 0) return undefined;
    const v = args[i + 1];
    if (!v || v.startsWith("--")) throw new Error(`${op} necesita un archivo`);
    return v;
  };
  const fuentes = args.flatMap((a, i) => (a === "--fuente" && args[i + 1] ? [args[i + 1]] : []));
  const archivoRestaurar = valor("--restaurar");
  const archivoRespaldo = valor("--respaldo");
  const prisma = new PrismaClient();
  try {
    if (archivoRestaurar) {
      const { cambios } = JSON.parse(fs.readFileSync(archivoRestaurar, "utf-8"));
      log("restaurado", JSON.stringify(await restaurar(prisma, cambios)), "de", cambios.length);
      return;
    }
    const cambios = await planear(prisma, fuentes);
    log("plan", JSON.stringify(resumen(cambios)));
    if (!args.includes("--aplicar")) {
      log("prueba (sin escribir)");
      return;
    }
    if (!archivoRespaldo) throw new Error("--aplicar necesita --respaldo ARCHIVO (sin respaldo no se escribe nada)");
    fs.writeFileSync(archivoRespaldo, JSON.stringify({ creado: new Date().toISOString(), fuentes, cambios }), { flag: "wx", mode: 0o600 });
    log("respaldo", archivoRespaldo, cambios.length, "deals");
    log("aplicado", JSON.stringify(await aplicar(prisma, cambios)));
    log("quedan distintos", (await planear(prisma, fuentes)).length);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(new Date().toISOString(), "error:", e && e.message ? e.message : e);
  process.exit(1);
});
