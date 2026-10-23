import type { PrismaClient } from "@prisma/client";
import { consultaArcgis } from "./catastro-valores";

/**
 * ZONIFICACION DE MIAMI-DADE POR UBICACION (23-oct-2026, decision de JR: zoning gratis empezando por Miami-Dade).
 *
 * Ninguna capa de parcelas trae zoning (ver zoning.ts). Se cruza el punto de cada deal con las capas del condado:
 *   MD_Emaps 17, Municipal Zoning: zoning de cada municipio (Miami 21 en la ciudad de Miami: T6-80-O, T3-O...).
 *   MD_Emaps 14, County Zoning: el no incorporado, donde la 17 dice ZONE "NONE" (RU-1, RU-2, EU-1...).
 * Una consulta por punto tarda 0,1 s (medido el 23-oct). Se guarda "codigo (descripcion)" en Deal.zoning; sin poligono,
 * queda null.
 */
export const CAPA_ZONING_MUNICIPAL = "https://gisweb.miamidade.gov/arcgis/rest/services/MD_Emaps/MapServer/17";
export const CAPA_ZONING_CONDADO = "https://gisweb.miamidade.gov/arcgis/rest/services/MD_Emaps/MapServer/14";

type Consulta = (url: string, parametros: Record<string, string>) => Promise<unknown[]>;

const limpiar = (v: unknown) => String(v ?? "").replace(/[ÿ ]/g, " ").replace(/\s+/g, " ").trim();

export function textoZoning(zona: unknown, descripcion: unknown): string | null {
  const z = limpiar(zona);
  if (!z || z.toUpperCase() === "NONE") return null;
  const d = limpiar(descripcion);
  return d && d.toUpperCase() !== "NONE" ? `${z} (${d})` : z;
}

const atributos = (filas: unknown[]) => filas.map((f) => ((f as { attributes?: Record<string, unknown> })?.attributes) ?? {});

export async function zoningEnPunto(longitud: number, latitud: number, consultar: Consulta = consultaArcgis): Promise<string | null> {
  const punto = {
    geometry: `${longitud},${latitud}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
  };
  for (const a of atributos(await consultar(CAPA_ZONING_MUNICIPAL, punto))) {
    const texto = textoZoning(a.ZONE, a.ZONEDESC);
    if (texto) return texto;
  }
  for (const a of atributos(await consultar(CAPA_ZONING_CONDADO, punto))) {
    const texto = textoZoning(a.ZONE, a.ZONE_DESC);
    if (texto) return texto;
  }
  return null;
}

/** Deals de Miami-Dade con coordenadas y sin zoning (o todos, con `todos`). Sin `aplicar` solo cuenta. */
export async function cargarZoningMiamiDade(
  prisma: Pick<PrismaClient, "deal">,
  opciones: { aplicar: boolean; todos?: boolean; limite?: number; buscar?: Consulta },
): Promise<{ deals: number; conZoning: number }> {
  const deals = await prisma.deal.findMany({
    where: {
      source: "miami-dade-parcels",
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
    const zoning = await zoningEnPunto(deal.longitude as number, deal.latitude as number, opciones.buscar);
    if (!zoning) continue;
    conZoning += 1;
    if (opciones.aplicar) await prisma.deal.update({ where: { id: deal.id }, data: { zoning } });
  }
  return { deals: deals.length, conZoning };
}
