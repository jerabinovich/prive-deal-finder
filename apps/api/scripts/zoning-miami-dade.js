/**
 * Zoning de Miami-Dade por ubicacion (src/integrations/zoning-miami-dade.ts). Repetible: sin --todos solo toca deals
 * sin zoning.
 *
 * Uso, desde apps/api, despues del build y con el .env cargado:
 *   node scripts/zoning-miami-dade.js                    cuenta lo que cargaria (no escribe)
 *   node scripts/zoning-miami-dade.js --aplicar          carga el zoning de los deals que no lo tienen
 *   node scripts/zoning-miami-dade.js --aplicar --todos  vuelve a pasar por todos (cambios de zonificacion)
 *   --limite N                                           N deals
 */
const { PrismaClient } = require("@prisma/client");
const { cargarZoningMiamiDade } = require("../dist/integrations/zoning-miami-dade");

async function main() {
  const args = process.argv.slice(2);
  const iLimite = args.indexOf("--limite");
  const prisma = new PrismaClient();
  try {
    const r = await cargarZoningMiamiDade(prisma, {
      aplicar: args.includes("--aplicar"),
      todos: args.includes("--todos"),
      limite: iLimite >= 0 ? Number(args[iLimite + 1]) : undefined,
    });
    console.log(new Date().toISOString(), args.includes("--aplicar") ? "aplicado" : "prueba (sin escribir)", JSON.stringify(r));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(new Date().toISOString(), "error:", e && e.message ? e.message : e);
  process.exit(1);
});
