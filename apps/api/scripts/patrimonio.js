/**
 * Patrimonio estimado de los deals de Broward con senal de distress (src/integrations/patrimonio-broward.ts):
 * tasacion del catastro menos la deuda hipotecaria abierta del registro oficial, y la clase del acreedor.
 * Lee el indice local (~/broward-or/raw y ~/broward-or/diario). Gratis: no consulta nada pago.
 *
 * Uso, desde apps/api, despues del build y con el .env cargado:
 *   node scripts/patrimonio.js                        calcula y cuenta, no escribe
 *   node scripts/patrimonio.js --aplicar              guarda el detalle (StagingRecord patrimonio-estimado), el ratio y la
 *                                                     confianza en el deal, y recalcula el score de todos los estimados
 *                                                     (solo escribe los que difieren)
 *   --limite N                                        N deals
 *   --json ruta                                       deja todas las estimaciones en un archivo para revisar
 */
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const { calcularPatrimonio } = require("../dist/integrations/patrimonio-broward");
const { recalcularPuntaje } = require("../dist/integrations/rescore-distress");
const { leerLimite } = require("../dist/integrations/argumentos");

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes("--aplicar");
  const iJson = args.indexOf("--json");
  const prisma = new PrismaClient();
  try {
    const t0 = Date.now();
    const r = await calcularPatrimonio(prisma, {
      aplicar,
      limite: leerLimite(args),
      recalcular: (ids) => recalcularPuntaje(prisma, ids),
      log: (m) => console.log(new Date().toISOString(), m),
    });
    if (iJson >= 0 && args[iJson + 1]) fs.writeFileSync(args[iJson + 1], JSON.stringify(r.estimaciones, null, 1));
    const { estimaciones: _estimaciones, ...resto } = r;
    console.log(new Date().toISOString(), aplicar ? "aplicado" : "prueba (sin escribir)", JSON.stringify({ ...resto, segundos: Math.round((Date.now() - t0) / 1000) }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(new Date().toISOString(), "error:", e && e.message ? e.message : e);
  process.exit(1);
});
