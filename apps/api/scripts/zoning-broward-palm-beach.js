/**
 * Zoning de Broward y Palm Beach por ubicacion (src/integrations/zoning-broward-palm-beach.ts). Repetible: sin --todos
 * solo toca deals sin zoning. Miami-Dade sigue con scripts/zoning-miami-dade.js.
 *
 * Uso, desde apps/api, despues del build y con el .env cargado:
 *   node scripts/zoning-broward-palm-beach.js                    cuenta lo que cargaria (no escribe)
 *   node scripts/zoning-broward-palm-beach.js --aplicar          carga el zoning de los deals que no lo tienen
 *   node scripts/zoning-broward-palm-beach.js --aplicar --todos  vuelve a pasar por todos (cambios de zonificacion)
 *   --fuente broward-parcels                                     una sola fuente (se puede repetir)
 *   --limite N                                                   N deals por fuente
 */
const { PrismaClient } = require("@prisma/client");
const { cargarZoningPorUbicacion } = require("../dist/integrations/zoning-broward-palm-beach");
const { leerLimite } = require("../dist/integrations/argumentos");

async function main() {
  const args = process.argv.slice(2);
  const limite = leerLimite(args);
  const pedidas = args.flatMap((a, i) => (a === "--fuente" && args[i + 1] ? [args[i + 1]] : []));
  const fuentes = pedidas.length ? pedidas : ["broward-parcels", "palm-beach-parcels"];
  const prisma = new PrismaClient();
  try {
    for (const fuente of fuentes) {
      const r = await cargarZoningPorUbicacion(prisma, {
        fuente,
        aplicar: args.includes("--aplicar"),
        todos: args.includes("--todos"),
        limite,
      });
      console.log(new Date().toISOString(), args.includes("--aplicar") ? "aplicado" : "prueba (sin escribir)", JSON.stringify(r));
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(new Date().toISOString(), "error:", e && e.message ? e.message : e);
  process.exit(1);
});
