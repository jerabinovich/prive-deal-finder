import type { PrismaClient } from "@prisma/client";
import { consultaArcgis } from "./catastro-valores";
import { textoZoning, zoningEnPunto } from "./zoning-miami-dade";

/**
 * ZONIFICACION DE BROWARD Y PALM BEACH POR UBICACION (3-nov-2026, OK de JR: seguir despues de Miami-Dade).
 *
 * Mismo camino que zoning-miami-dade.ts: el punto de cada deal contra una capa de poligonos del condado.
 *   Broward, BCPA_EXTERNAL_JAN26 9, City Zoning Codes: el codigo de cada ciudad en ZONE_NAME (RMM-25, B-3, PUD);
 *     ZONING casi siempre viene vacio. Donde hay superpuestos (AOD sobre RM-20 en Pompano) se guardan todos.
 *   Palm Beach, Planning_Open_Data 9, Zoning: el condado y los municipios en una sola capa; FCODE trae el codigo
 *     (los municipales con la marca "(city)", que se saca) y FNAME el nombre del distrito.
 * Medido el 3-nov sobre 60 deals al azar de cada condado: 60 de 60 con zoning, 0,15 s y 0,21 s por consulta.
 * Monroe y Martin no tienen capa gratis: no estan en ZONING_POR_FUENTE.
 */
export const CAPA_ZONING_BROWARD = "https://gisweb-adapters.bcpa.net/arcgis/rest/services/BCPA_EXTERNAL_JAN26/MapServer/9";
export const CAPA_ZONING_PALM_BEACH = "https://maps.co.palm-beach.fl.us/arcgis/rest/services/OpenData/Planning_Open_Data/MapServer/9";

type Consulta = (url: string, parametros: Record<string, string>) => Promise<unknown[]>;
type ZoningEnPunto = (longitud: number, latitud: number, consultar?: Consulta) => Promise<string | null>;

const atributos = (filas: unknown[]) => filas.map((f) => ((f as { attributes?: Record<string, unknown> })?.attributes) ?? {});

async function zoningDeCapa(
  capa: string,
  longitud: number,
  latitud: number,
  consultar: Consulta,
  texto: (a: Record<string, unknown>) => string | null,
): Promise<string | null> {
  const filas = await consultar(capa, {
    geometry: `${longitud},${latitud}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
  });
  const textos = [...new Set(atributos(filas).map(texto).filter((t): t is string => Boolean(t)))];
  return textos.length ? textos.join("; ") : null;
}

export const zoningBroward: ZoningEnPunto = (longitud, latitud, consultar = consultaArcgis) =>
  zoningDeCapa(CAPA_ZONING_BROWARD, longitud, latitud, consultar, (a) => textoZoning(a.ZONE_NAME, a.ZONING));

export const zoningPalmBeach: ZoningEnPunto = (longitud, latitud, consultar = consultaArcgis) =>
  zoningDeCapa(CAPA_ZONING_PALM_BEACH, longitud, latitud, consultar, (a) =>
    textoZoning(String(a.FCODE ?? "").replace(/\s*\(city\)\s*$/i, ""), a.FNAME));

export const ZONING_POR_FUENTE: Record<string, ZoningEnPunto> = {
  "miami-dade-parcels": zoningEnPunto,
  "broward-parcels": zoningBroward,
  "palm-beach-parcels": zoningPalmBeach,
};

/** Deals de la fuente con coordenadas y sin zoning (o todos, con `todos`). Sin `aplicar` solo cuenta. */
export async function cargarZoningPorUbicacion(
  prisma: Pick<PrismaClient, "deal">,
  opciones: { fuente: string; aplicar: boolean; todos?: boolean; limite?: number; buscar?: Consulta },
): Promise<{ fuente: string; deals: number; conZoning: number }> {
  const zoningEn = ZONING_POR_FUENTE[opciones.fuente];
  if (!zoningEn) throw new Error(`sin capa de zoning para ${opciones.fuente}`);
  const deals = await prisma.deal.findMany({
    where: {
      source: opciones.fuente,
      latitude: { not: null },
      longitude: { not: null },
      ...(opciones.todos ? {} : { zoning: null }),
    },
    select: { id: true, longitude: true, latitude: true },
    orderBy: { createdAt: "asc" },
    ...(opciones.limite ? { take: opciones.limite } : {}),
  });
  let conZoning = 0;
  for (const deal of deals) {
    const zoning = await zoningEn(deal.longitude as number, deal.latitude as number, opciones.buscar);
    if (!zoning) continue;
    conZoning += 1;
    if (opciones.aplicar) await prisma.deal.update({ where: { id: deal.id }, data: { zoning } });
  }
  return { fuente: opciones.fuente, deals: deals.length, conZoning };
}
