/**
 * Repara el cruce expediente a folio de Broward guardado antes del 13-oct-2026. Repetible sin efecto.
 *
 * La ingesta buscaba al demandado por la primera palabra del nombre y se quedaba con el primer folio, y
 * pegaba expedientes a propiedades de otros (ver src/integrations/broward-demandado.ts). Este script
 * vuelve a resolver cada expediente guardado con la regla nueva, la misma que usa la ingesta, y:
 *   - MANTENER: el deal de la senal es un folio del demandado. Solo anota la resolucion.
 *   - MOVER: el folio era de otro dueño. La senal pasa al deal correcto (se crea si no existe) y, si el
 *     demandado tiene hasta 3 folios en la misma ciudad, se copia a los otros.
 *   - QUITAR: no se puede enganchar sin adivinar (homonimos, sin coincidencia). Solo con
 *     --quitar-sin-folio se borra; sin esa opcion queda donde esta y se informa.
 * Despues recalcula etapa y score de todos los deals tocados con rescore-distress.ts. El carril lo
 * recalcula despues POST /api/deals/recompute-triage.
 *
 * Si una consulta al catastro falla tres veces, no escribe nada: se vuelve a correr.
 *
 * Uso, desde apps/api, despues del build y con el .env cargado:
 *   node scripts/reparar-folios-broward-2026-10-13.js                       muestra lo que haria
 *   node scripts/reparar-folios-broward-2026-10-13.js --aplicar             mueve, copia y anota
 *   node scripts/reparar-folios-broward-2026-10-13.js --aplicar --quitar-sin-folio
 *   --json <archivo>                                                        detalle por expediente
 */
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const { demandanteDeCaratula, resolverDemandadoBroward } = require("../dist/integrations/broward-demandado");
const { clasificarClaseCaso } = require("../dist/deals/distress-classification");
const { ingestArcgisRecords } = require("../dist/integrations/arcgis.ingest");
const { recalcularDistressYPuntaje } = require("../dist/integrations/rescore-distress");

const FUENTE = "broward-foreclosure";

function leer(metadata) {
  try {
    const v = JSON.parse(metadata || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function direccionDelFeature(f) {
  const a = (f && f.attributes) || {};
  const partes = ["SITUS_STREET_NUMBER", "SITUS_STREET_DIRECTION", "SITUS_STREET_NAME", "SITUS_STREET_TYPE",
    "SITUS_STREET_POST_DIR", "SITUS_UNIT_NUMBER"].map((k) => String(a[k] || "").trim()).filter(Boolean);
  return `${a.FOLIO_NUMBER} ${partes.join(" ")} [${String(a.SITUS_CITY || "").trim()}] uso ${a.USE_CODE} dueño ${String(a.NAME_LINE_1 || "").trim()}`;
}

async function resolverConReintentos(url, demandado, contexto) {
  let ultimo;
  for (let i = 0; i < 3; i += 1) {
    try {
      return await resolverDemandadoBroward(url, demandado, contexto);
    } catch (e) {
      ultimo = e;
      await new Promise((r) => setTimeout(r, 4000 * (i + 1)));
    }
  }
  throw ultimo;
}

async function main() {
  const aplicar = process.argv.includes("--aplicar");
  const quitar = process.argv.includes("--quitar-sin-folio");
  const iJson = process.argv.indexOf("--json");
  const archivoJson = iJson > 0 ? process.argv[iJson + 1] : null;
  const url = process.env.BROWARD_PARCELS_URL;
  if (!url) throw new Error("falta BROWARD_PARCELS_URL en el entorno");

  const prisma = new PrismaClient();
  try {
    const senales = await prisma.dealDistressSignal.findMany({
      where: { source: FUENTE },
      include: { deal: { select: { id: true, parcelId: true, address: true, city: true, lane: true } } },
      orderBy: { id: "asc" },
    });
    // Un caso puede estar en mas de un deal: se resuelve una vez por caso.
    const porCaso = new Map();
    for (const s of senales) {
      const clave = s.externalId || `sin-caso:${s.id}`;
      if (!porCaso.has(clave)) porCaso.set(clave, []);
      porCaso.get(clave).push(s);
    }

    // El catastro tarda (una consulta LIKE puede llevar casi un minuto): cuatro casos a la vez.
    const plan = [];
    const fallas = [];
    const cola = [...porCaso.entries()];
    // eslint-disable-next-line no-inner-declarations -- script de un solo uso (13-oct), ya corrido: no se le cambia la logica
    async function trabajador() {
      while (cola.length) {
        const [caso, lista] = cola.shift();
        const meta = leer(lista[0].metadata);
        const demandado = String(meta.defendantName || "").trim();
        const interno = meta.metadata && typeof meta.metadata === "object" ? meta.metadata : {};
        const clase = clasificarClaseCaso(String(meta.caseTypeCode || interno.Case_Type || ""));
        const demandante = demandanteDeCaratula(String(meta.caption || interno.Caption || ""));
        let r;
        try {
          r = await resolverConReintentos(url, demandado, { clase, demandante });
        } catch (e) {
          fallas.push({ caso, demandado, error: String((e && e.message) || e) });
          continue;
        }
        const nuevos = r.resolucion.folios;
        const actuales = lista.map((s) => s.deal.parcelId);
        const igual =
          nuevos.length > 0 && nuevos.length === new Set(actuales).size && actuales.every((a) => nuevos.includes(a));
        const accion = !nuevos.length ? "QUITAR" : igual ? "MANTENER" : "MOVER";
        plan.push({ caso, demandado, clase, resolucion: r.resolucion, features: r.features, senales: lista, accion });
      }
    }
    await Promise.all([trabajador(), trabajador(), trabajador(), trabajador()]);
    plan.sort((a, b) => a.caso.localeCompare(b.caso));

    // Deals que se quedarian sin ninguna senal (de cualquier fuente).
    const salen = new Map();
    for (const p of plan) {
      if (p.accion === "MANTENER" || (p.accion === "QUITAR" && !quitar)) continue;
      for (const s of p.senales) {
        if (p.resolucion.folios.includes(s.deal.parcelId)) continue;
        salen.set(s.dealId, (salen.get(s.dealId) || 0) + 1);
      }
    }
    const huerfanos = [];
    for (const [dealId, n] of salen) {
      const total = await prisma.dealDistressSignal.count({ where: { dealId } });
      if (total - n <= 0) {
        const d = await prisma.deal.findUnique({ where: { id: dealId }, select: { id: true, address: true, city: true, source: true, lane: true } });
        huerfanos.push(d);
      }
    }

    const conteo = (k) => plan.reduce((acc, p) => ((acc[p[k]] = (acc[p[k]] || 0) + 1), acc), {});
    const porEstado = plan.reduce((acc, p) => ((acc[p.resolucion.estado] = (acc[p.resolucion.estado] || 0) + 1), acc), {});
    console.log(`senales ${senales.length}, casos ${porCaso.size}, resueltos ${plan.length}, fallas ${fallas.length}`);
    console.log("accion", JSON.stringify(conteo("accion")));
    console.log("estado", JSON.stringify(porEstado));
    const distressAfectados = plan.filter((p) => p.accion !== "MANTENER" && p.senales.some((s) => s.deal.lane === "DISTRESS_OWNER"));
    console.log(`casos hoy en DISTRESS_OWNER que cambian: ${distressAfectados.length}`);
    console.log(`deals que quedarian sin ninguna senal: ${huerfanos.length}`);
    for (const p of plan.filter((x) => x.accion !== "MANTENER")) {
      const antes = p.senales.map((s) => `${s.deal.address} ${s.deal.city} (${s.deal.lane})`).join(" + ");
      const ahora = p.features.length ? p.features.map(direccionDelFeature).join(" + ") : p.resolucion.motivo;
      console.log(`${p.accion.padEnd(8)} ${p.resolucion.estado.padEnd(16)} ${p.caso} ${p.demandado.slice(0, 40)} | antes: ${antes} | ahora: ${ahora}`);
    }
    for (const f of fallas) console.log(`FALLA ${f.caso} ${f.demandado}: ${f.error}`);

    if (archivoJson) {
      const detalle = plan.map((p) => ({
        caso: p.caso, demandado: p.demandado, clase: p.clase, accion: p.accion, resolucion: p.resolucion,
        antes: p.senales.map((s) => ({ signalId: s.id, dealId: s.dealId, parcelId: s.deal.parcelId, address: s.deal.address, city: s.deal.city, lane: s.deal.lane })),
        ahora: p.features.map(direccionDelFeature),
      }));
      fs.writeFileSync(archivoJson, JSON.stringify({ fallas, huerfanos, detalle }, null, 1));
    }

    if (fallas.length) {
      console.log("Hubo consultas fallidas: no se escribe nada. Volver a correr.");
      process.exitCode = 2;
      return;
    }
    if (!aplicar) {
      console.log("Solo lectura. Para escribir: --aplicar (y --quitar-sin-folio para borrar las que no enganchan).");
      return;
    }

    const features = plan.filter((p) => p.accion === "MOVER").flatMap((p) => p.features);
    if (features.length) {
      const ingesta = await ingestArcgisRecords(prisma, "broward-parcels", "Broward", features);
      console.log(`deals creados ${ingesta.createdDeals}, actualizados ${ingesta.updatedDeals}`);
    }

    const tocados = new Set();
    const hechos = { anotadas: 0, movidas: 0, copiadas: 0, borradas: 0 };
    for (const p of plan) {
      const metaNueva = (s) =>
        JSON.stringify({ ...leer(s.metadata), parcelId: p.resolucion.folios[0] || null, parcelIds: p.resolucion.folios, resolucionFolio: p.resolucion });

      if (p.accion === "QUITAR") {
        if (!quitar) continue;
        await prisma.$transaction(p.senales.map((s) => prisma.dealDistressSignal.delete({ where: { id: s.id } })));
        p.senales.forEach((s) => tocados.add(s.dealId));
        hechos.borradas += p.senales.length;
        continue;
      }

      const destinos = [];
      for (const folio of p.resolucion.folios) {
        const d = await prisma.deal.findFirst({ where: { parcelId: folio }, select: { id: true } });
        if (!d) throw new Error(`no existe el deal del folio ${folio} (caso ${p.caso})`);
        destinos.push(d.id);
      }
      const yaEnDestino = p.senales.filter((s) => destinos.includes(s.dealId));
      const sobrantes = p.senales.filter((s) => !destinos.includes(s.dealId));
      const faltan = destinos.filter((d) => !yaEnDestino.some((s) => s.dealId === d));
      const base = p.senales[0];
      const ops = [];
      for (const s of yaEnDestino) {
        ops.push(prisma.dealDistressSignal.update({ where: { id: s.id }, data: { metadata: metaNueva(s) } }));
        hechos.anotadas += 1;
      }
      for (const d of faltan) {
        const s = sobrantes.shift();
        if (s) {
          ops.push(prisma.dealDistressSignal.update({ where: { id: s.id }, data: { dealId: d, metadata: metaNueva(s) } }));
          hechos.movidas += 1;
        } else {
          ops.push(prisma.dealDistressSignal.create({
            data: {
              dealId: d, source: base.source, externalId: base.externalId, status: base.status,
              confidence: base.confidence, observedAt: base.observedAt, metadata: metaNueva(base),
            },
          }));
          hechos.copiadas += 1;
        }
      }
      // El mismo caso repetido en otros deals equivocados: sobra.
      for (const s of sobrantes) {
        ops.push(prisma.dealDistressSignal.delete({ where: { id: s.id } }));
        hechos.borradas += 1;
      }
      await prisma.$transaction(ops);
      p.senales.forEach((s) => tocados.add(s.dealId));
      destinos.forEach((d) => tocados.add(d));
    }
    const recalculados = await recalcularDistressYPuntaje(prisma, [...tocados]);
    console.log(`hecho: ${JSON.stringify(hechos)}; deals tocados ${tocados.size}; etapa o score cambiados ${recalculados}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
