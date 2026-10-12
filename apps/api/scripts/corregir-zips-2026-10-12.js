/**
 * Corrige los zips guardados antes del 12-oct-2026. Una sola vez; se puede repetir sin efecto.
 *
 *   - Todos los mercados: a 5 digitos ("33132-0000" da "33132", "333231640" da "33323", "0" da null).
 *   - Palm Beach: la capa de parcelas no trae zip del sitio y lo guardado era el del DUENO. Sale de
 *     las coordenadas de la parcela contra las ZCTA del Census (src/integrations/zip.ts). Si alguna
 *     consulta al Census falla, no se escribe nada: se vuelve a correr.
 *
 * Uso, desde apps/api y despues del build:
 *   node scripts/corregir-zips-2026-10-12.js            muestra lo que cambiaria
 *   node scripts/corregir-zips-2026-10-12.js --aplicar  lo escribe
 */
const { PrismaClient } = require("@prisma/client");
const { normalizarZip, zipPorCoordenadas } = require("../dist/integrations/zip");

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const prisma = new PrismaClient();
  try {
    const deals = await prisma.deal.findMany({
      select: { id: true, market: true, zip: true, latitude: true, longitude: true, address: true },
      orderBy: { id: "asc" },
    });
    const cambios = [];
    const fallasCensus = [];
    for (const d of deals) {
      const palmBeach = (d.market || "").toLowerCase().includes("palm beach");
      let nuevo;
      if (palmBeach) {
        nuevo = await zipPorCoordenadas(d.latitude, d.longitude);
        if (nuevo === null && typeof d.latitude === "number") fallasCensus.push(d.id);
      } else {
        nuevo = normalizarZip(d.zip);
      }
      if ((nuevo ?? null) !== (d.zip ?? null)) {
        cambios.push({ id: d.id, market: d.market || "", antes: d.zip, despues: nuevo ?? null, address: d.address || "" });
      }
    }
    const porMercado = {};
    for (const c of cambios) porMercado[c.market] = (porMercado[c.market] || 0) + 1;
    console.log(`deals ${deals.length}, a cambiar ${cambios.length}, por mercado ${JSON.stringify(porMercado)}`);
    for (const c of cambios.filter((x) => x.market.toLowerCase().includes("palm beach")).slice(0, 12)) {
      console.log(`  Palm Beach  ${String(c.antes).padEnd(10)} -> ${String(c.despues).padEnd(6)} ${c.address}`);
    }
    const ejemplos = {};
    for (const c of cambios) {
      const forma = `${c.market}: ${/^\d{5}-\d{4}$/.test(c.antes || "") ? "5-4" : /^\d{9}$/.test(c.antes || "") ? "9 digitos" : c.antes}`;
      ejemplos[forma] = (ejemplos[forma] || 0) + 1;
    }
    console.log("formas que se corrigen:", JSON.stringify(ejemplos));
    if (fallasCensus.length) {
      console.log(`ATENCION: ${fallasCensus.length} consultas al Census sin respuesta; no se escribe nada. Volver a correr.`);
      process.exitCode = 2;
      return;
    }
    if (!aplicar) {
      console.log("simulacion: no se escribio nada (usar --aplicar)");
      return;
    }
    for (const c of cambios) {
      await prisma.deal.update({ where: { id: c.id }, data: { zip: c.despues } });
    }
    console.log(`aplicado: ${cambios.length} deals`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
