/**
 * Completa lo guardado (13-oct-2026): domicilio postal del dueno y mercado canonico. Repetible sin efecto.
 *
 * 1. Palm Beach: el domicilio de su propia capa (PADDR1 a PADDR3), leido de la ultima copia cruda de cada
 *    parcela en StagingRecord.
 * 2. Broward, Miami-Dade y lo que quede de Palm Beach: el rol estatal, solo si el dueno coincide
 *    (completarDomiciliosPostales, la misma funcion que corre despues de cada sync).
 * 3. Mercado: "South Florida - Miami-Dade (Little Havana)" pasa a "Miami-Dade" con submarket "Little Havana".
 *
 * No pisa ningun domicilio existente ni imprime domicilios: solo cuentas. La contactabilidad la recalcula
 * despues el triage.
 *
 * Uso, desde apps/api, despues del build y con el .env cargado:
 *   node scripts/domicilio-y-mercado-2026-10-13.js            muestra lo que cambiaria
 *   node scripts/domicilio-y-mercado-2026-10-13.js --aplicar  lo escribe
 */
const { PrismaClient } = require("@prisma/client");
const {
  CONDADO_DOR,
  completarDomiciliosPostales,
  domicilioDeLaCapa,
  domiciliosEstatales,
  mismoDueno,
} = require("../dist/integrations/domicilio-postal");
const { normalizarMercado } = require("../dist/deals/mercado");

const vacio = [{ mailingAddress: null }, { mailingAddress: "" }];
const folio = (f) => String(f || "").toUpperCase().replace(/[^0-9A-Z]/g, "");

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const prisma = new PrismaClient();
  try {
    // 1. Palm Beach desde su capa
    const pb = await prisma.deal.findMany({ where: { source: "palm-beach-parcels", OR: vacio }, select: { id: true, parcelId: true } });
    const crudos = await prisma.stagingRecord.findMany({ where: { source: "palm-beach-parcels" }, orderBy: { receivedAt: "desc" }, select: { payload: true } });
    const porFolio = new Map();
    for (const c of crudos) {
      let p;
      try {
        p = typeof c.payload === "string" ? JSON.parse(c.payload) : c.payload;
      } catch {
        continue;
      }
      const a = (p && (p.attributes || p)) || {};
      const id = folio(a.PARID || a.PARCEL_NUMBER || a.PARCEL_ID);
      if (id && !porFolio.has(id)) porFolio.set(id, domicilioDeLaCapa(a));
    }
    const pbCapa = pb.map((d) => ({ d, dom: porFolio.get(folio(d.parcelId)) })).filter((x) => x.dom);
    console.log(`palm-beach-parcels: sin domicilio ${pb.length}; con domicilio en su capa ${pbCapa.length}`);
    if (aplicar) {
      let n = 0;
      for (const { d, dom } of pbCapa) n += (await prisma.deal.updateMany({ where: { id: d.id, OR: vacio }, data: { mailingAddress: dom } })).count;
      console.log(`  escritos desde la capa ${n}`);
    }

    // 2. Rol estatal
    for (const source of Object.keys(CONDADO_DOR)) {
      if (aplicar) {
        const r = await completarDomiciliosPostales(prisma, source, 5000);
        console.log(`${source}: rol estatal, revisados ${r.revisados}; escritos ${r.escritos}; dueno distinto ${r.duenoDistinto}`);
        continue;
      }
      const deals = await prisma.deal.findMany({
        where: { source, parcelId: { not: null }, OR: vacio },
        select: { id: true, parcelId: true, owners: { select: { owner: { select: { name: true } } } } },
      });
      const pendientes = source === "palm-beach-parcels" ? deals.filter((d) => !porFolio.get(folio(d.parcelId))) : deals;
      const filas = await domiciliosEstatales(CONDADO_DOR[source], pendientes.map((d) => String(d.parcelId)));
      let escribiria = 0, distinto = 0, sinFila = 0;
      for (const d of pendientes) {
        const f = filas.get(folio(d.parcelId));
        if (!f) { sinFila++; continue; }
        const nombres = d.owners.map((o) => (o.owner && o.owner.name) || "").filter(Boolean);
        if (nombres.length && !nombres.some((n) => mismoDueno(n, f.nombre))) distinto++;
        else escribiria++;
      }
      console.log(`${source}: rol estatal, revisados ${pendientes.length}; escribiria ${escribiria}; dueno distinto ${distinto}; sin fila en el rol ${sinFila}`);
    }

    // 3. Mercado
    const todos = await prisma.deal.findMany({ select: { id: true, market: true, submarket: true } });
    const cambios = todos
      .map((d) => ({ d, n: normalizarMercado(d.market, d.submarket) }))
      .filter(({ d, n }) => (n.market ?? null) !== (d.market ?? null) || (n.submarket ?? null) !== (d.submarket ?? null));
    console.log(`mercado: a normalizar ${cambios.length}`);
    for (const { d, n } of cambios) console.log(`  "${d.market}" -> "${n.market}" (submarket "${n.submarket ?? ""}")`);
    if (aplicar) {
      for (const { d, n } of cambios) await prisma.deal.update({ where: { id: d.id }, data: { market: n.market ?? null, submarket: n.submarket ?? null } });
    }

    const total = await prisma.deal.count();
    const con = await prisma.deal.count({ where: { NOT: vacio } });
    console.log(`deals con domicilio postal: ${con} de ${total}`);
    if (!aplicar) console.log("Solo lectura. Para escribir: --aplicar");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
