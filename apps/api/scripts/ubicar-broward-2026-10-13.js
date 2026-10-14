/**
 * Ubica los deals de Broward guardados antes del 13-oct-2026. Repetible sin efecto.
 *
 * La tabla del Property Appraiser no trae geometria y guarda la ciudad como codigo: los deals de Broward
 * estaban sin coordenadas, con la ciudad en "FL", "BC" o "PA", y 26 sin zip. Este script usa lo mismo que
 * la ingesta (src/integrations/broward-parcelas.ts y ciudades-broward.ts):
 *   - ciudad y municipio: el codigo pasa a nombre (medido contra City Limits);
 *   - coordenadas: el poligono del folio, o el del edificio si es una unidad de condominio;
 *   - zip: solo si esta vacio, el de las coordenadas contra las ZCTA del Census.
 * No pisa coordenadas ni zips que ya existen. Si alguna consulta al Census falla, no escribe nada.
 *
 * Uso, desde apps/api, despues del build y con el .env cargado:
 *   node scripts/ubicar-broward-2026-10-13.js            muestra lo que cambiaria
 *   node scripts/ubicar-broward-2026-10-13.js --aplicar  lo escribe
 */
const { PrismaClient } = require("@prisma/client");
const { ubicacionesBroward } = require("../dist/integrations/broward-parcelas");
const { ciudadBroward } = require("../dist/integrations/ciudades-broward");
const { consultarZcta } = require("../dist/integrations/zip");

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const url = process.env.BROWARD_PARCELS_URL;
  if (!url) throw new Error("falta BROWARD_PARCELS_URL en el entorno");
  const prisma = new PrismaClient();
  try {
    const deals = await prisma.deal.findMany({
      where: { OR: [{ market: { contains: "Broward", mode: "insensitive" } }, { source: { startsWith: "broward" } }] },
      select: { id: true, parcelId: true, address: true, city: true, municipality: true, zip: true, latitude: true, longitude: true },
      orderBy: { id: "asc" },
    });
    const sinCoordenadas = deals.filter((d) => d.latitude == null || d.longitude == null).map((d) => d.parcelId).filter(Boolean);
    const ubicaciones = await ubicacionesBroward(url, sinCoordenadas);

    const cambios = [];
    const fallasCensus = [];
    const sinUbicacion = [];
    const sinZcta = [];
    for (const d of deals) {
      const data = {};
      const ciudad = ciudadBroward(d.city);
      if (ciudad && ciudad !== d.city) data.city = ciudad;
      const municipio = ciudadBroward(d.municipality);
      if (municipio && municipio !== d.municipality) data.municipality = municipio;
      if (!d.municipality && (ciudad || d.city)) data.municipality = ciudad || d.city;
      let lat = d.latitude;
      let lon = d.longitude;
      if (lat == null || lon == null) {
        const u = d.parcelId ? ubicaciones.get(String(d.parcelId).toUpperCase()) : undefined;
        if (u) {
          data.latitude = u.y;
          data.longitude = u.x;
          lat = u.y;
          lon = u.x;
        } else {
          sinUbicacion.push(`${d.parcelId} ${d.address || ""}`);
        }
      }
      if (!d.zip && typeof lat === "number" && typeof lon === "number") {
        const r = await consultarZcta(lat, lon);
        if (!r.respondio) fallasCensus.push(d.id);
        else if (r.zip) data.zip = r.zip;
        else sinZcta.push(`${d.parcelId} ${d.address || ""}`);
      }
      if (Object.keys(data).length) cambios.push({ id: d.id, parcelId: d.parcelId, address: d.address, antes: { city: d.city, zip: d.zip }, data });
    }

    const cuenta = (k) => cambios.filter((c) => c.data[k] !== undefined).length;
    console.log(`deals de Broward ${deals.length}; con cambios ${cambios.length}`);
    console.log(`ciudad ${cuenta("city")}, municipio ${cuenta("municipality")}, coordenadas ${cuenta("latitude")}, zip ${cuenta("zip")}`);
    const porFuente = {};
    for (const u of ubicaciones.values()) porFuente[u.fuente] = (porFuente[u.fuente] || 0) + 1;
    console.log(`ubicaciones encontradas: ${JSON.stringify(porFuente)}; sin ubicacion ${sinUbicacion.length}`);
    for (const s of sinUbicacion) console.log(`  sin ubicacion: ${s}`);
    const zipsNuevos = {};
    for (const c of cambios.filter((x) => x.data.zip)) zipsNuevos[`${c.address} -> ${c.data.zip}`] = (zipsNuevos[`${c.address} -> ${c.data.zip}`] || 0) + 1;
    for (const [k, n] of Object.entries(zipsNuevos)) console.log(`  zip nuevo: ${k}${n > 1 ? ` (${n} deals)` : ""}`);
    for (const s of sinZcta) console.log(`  sin ZCTA en ese punto, queda sin zip: ${s}`);
    if (fallasCensus.length) {
      console.log(`El Census no contesto para ${fallasCensus.length} deals: no se escribe nada. Volver a correr.`);
      process.exitCode = 2;
      return;
    }
    if (!aplicar) {
      console.log("Solo lectura. Para escribir: --aplicar");
      return;
    }
    for (const c of cambios) await prisma.deal.update({ where: { id: c.id }, data: c.data });
    console.log(`escritos ${cambios.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
