/**
 * Registra folios descartados (14-oct-2026): la ingesta de parcelas no los vuelve a crear ni a actualizar
 * (src/integrations/descartados.ts). NO borra deals: el borrado va aparte, con respaldo completo.
 * Repetible sin efecto.
 *
 * Uso, desde apps/api, despues del build y con el .env cargado:
 *   node scripts/descartar-folios.js --motivo "texto" FOLIO [FOLIO ...]             muestra lo que haria
 *   node scripts/descartar-folios.js --motivo "texto" FOLIO [FOLIO ...] --aplicar   lo registra
 */
const { PrismaClient } = require("@prisma/client");

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes("--aplicar");
  const i = args.indexOf("--motivo");
  const motivo = i >= 0 ? args[i + 1] : null;
  const folios = [...new Set(args.filter((a, k) => !a.startsWith("--") && !(i >= 0 && k === i + 1)).map((a) => a.trim()).filter(Boolean))];
  if (!folios.length) throw new Error("faltan folios");
  if (!motivo) throw new Error("falta --motivo");
  const prisma = new PrismaClient();
  try {
    const ya = new Set((await prisma.folioDescartado.findMany({ where: { parcelId: { in: folios } } })).map((f) => f.parcelId));
    const deals = await prisma.deal.findMany({ where: { parcelId: { in: folios } }, select: { parcelId: true, address: true, lane: true } });
    for (const f of folios) {
      const d = deals.filter((x) => x.parcelId === f);
      console.log(`${f}: ${ya.has(f) ? "ya descartado" : "a descartar"}; deals con ese folio ${d.length}${d.length ? " (" + d.map((x) => `${x.address} ${x.lane}`).join("; ") + ")" : ""}`);
    }
    const nuevos = folios.filter((f) => !ya.has(f));
    console.log(`a registrar ${nuevos.length}`);
    if (!aplicar) {
      console.log("Solo lectura. Para escribir: --aplicar");
      return;
    }
    for (const f of nuevos) await prisma.folioDescartado.create({ data: { parcelId: f, motivo } });
    console.log(`registrados ${nuevos.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
