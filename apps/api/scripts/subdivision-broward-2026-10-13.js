/**
 * Anota en cada expediente de Broward guardado el nombre de la subdivision o del condominio de su
 * propiedad (13-oct-2026), y recalcula etapa y score de los deals tocados. Repetible sin efecto.
 *
 * Con ese nombre, distress-classification.ts reconoce al consorcio que demanda sin decir "association"
 * ("Chapel Trail Trade Center Inc" en el condominio CHAPEL TRAIL TRADE CENTER): cobra expensas, y por la
 * regla de JR no es oportunidad. El carril lo recalcula despues POST /api/deals/recompute-triage.
 *
 * Uso, desde apps/api, despues del build y con el .env cargado:
 *   node scripts/subdivision-broward-2026-10-13.js            muestra lo que cambiaria
 *   node scripts/subdivision-broward-2026-10-13.js --aplicar  lo escribe
 */
const { PrismaClient } = require("@prisma/client");
const { subdivisionesBroward } = require("../dist/integrations/broward-parcelas");
const { leerCasoForeclosure } = require("../dist/deals/distress-classification");
const { recalcularDistressYPuntaje } = require("../dist/integrations/rescore-distress");

function leer(m) {
  try {
    const v = JSON.parse(m || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const url = process.env.BROWARD_PARCELS_URL;
  if (!url) throw new Error("falta BROWARD_PARCELS_URL en el entorno");
  const prisma = new PrismaClient();
  try {
    const senales = await prisma.dealDistressSignal.findMany({
      where: { source: "broward-foreclosure" },
      include: { deal: { select: { id: true, parcelId: true, address: true, city: true, lane: true } } },
      orderBy: { id: "asc" },
    });
    const mapa = await subdivisionesBroward(url, senales.map((s) => s.deal.parcelId).filter(Boolean));
    const cambios = [];
    const consorcios = [];
    for (const s of senales) {
      const meta = leer(s.metadata);
      const nombre = mapa.get(String(s.deal.parcelId || "").toUpperCase());
      if (!nombre || meta.subdivision === nombre) continue;
      const antes = leerCasoForeclosure(s.metadata).demandanteEsConsorcio;
      const nueva = { ...meta, subdivision: nombre };
      const despues = leerCasoForeclosure(JSON.stringify(nueva)).demandanteEsConsorcio;
      cambios.push({ s, nueva });
      if (!antes && despues) consorcios.push(`${s.externalId} ${String(meta.caption || "").split(/\s+Plaintiff/i)[0].trim()} | ${s.deal.address} ${s.deal.city} (${s.deal.lane}) | ${nombre}`);
    }
    console.log(`senales ${senales.length}; con subdivision encontrada ${[...new Set(senales.map((s) => s.deal.parcelId))].filter((p) => mapa.has(String(p).toUpperCase())).length} folios; a anotar ${cambios.length}`);
    console.log(`demandantes que pasan a consorcio: ${consorcios.length}`);
    for (const c of consorcios) console.log(`  ${c}`);
    if (!aplicar) {
      console.log("Solo lectura. Para escribir: --aplicar");
      return;
    }
    for (const c of cambios) await prisma.dealDistressSignal.update({ where: { id: c.s.id }, data: { metadata: JSON.stringify(c.nueva) } });
    const n = await recalcularDistressYPuntaje(prisma, [...new Set(cambios.map((c) => c.s.dealId))]);
    console.log(`escritas ${cambios.length}; deals con etapa o score cambiados ${n}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
