/**
 * Carga tasacion, ventas de mercado y lote desde el catastro estatal, y las ventas de Broward y Palm Beach
 * (src/integrations/catastro-valores.ts).
 * Repetible sin efecto: actualiza la tasacion del mismo rol, no duplica ventas y no pisa lotes.
 *
 * Uso, desde apps/api, despues del build y con el .env cargado:
 *   node scripts/catastro-valores.js                          cuenta lo que cargaria (no escribe)
 *   node scripts/catastro-valores.js --aplicar                carga los deals que todavia no tienen tasacion del catastro
 *   node scripts/catastro-valores.js --aplicar --todos        vuelve a pasar por todos (rol nuevo, ventas nuevas)
 *   --fuente broward-parcels                                  una sola fuente (se puede repetir)
 *   --limite N                                                N deals por fuente
 */
const { PrismaClient } = require("@prisma/client");
const { enriquecerConCatastro } = require("../dist/integrations/catastro-valores");
const { leerLimite } = require("../dist/integrations/argumentos");

async function main() {
  const args = process.argv.slice(2);
  const fuentes = args.flatMap((a, i) => (a === "--fuente" && args[i + 1] ? [args[i + 1]] : []));
  const limite = leerLimite(args);
  const prisma = new PrismaClient();
  try {
    const r = await enriquecerConCatastro(prisma, {
      aplicar: args.includes("--aplicar"),
      todos: args.includes("--todos"),
      fuentes,
      limite,
      log: (m) => console.log(new Date().toISOString(), m),
    });
    const total = { deals: 0, tasaciones: 0, ventas: 0, ventasCondado: 0, lotes: 0, puntajes: 0 };
    for (const x of r) for (const k of Object.keys(total)) total[k] += x[k];
    console.log(new Date().toISOString(), args.includes("--aplicar") ? "aplicado" : "prueba (sin escribir)", JSON.stringify(total));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(new Date().toISOString(), "error:", e && e.message ? e.message : e);
  process.exit(1);
});
