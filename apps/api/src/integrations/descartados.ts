import { PrismaService } from "../shared/prisma.service";

/**
 * FOLIOS DESCARTADOS (14-oct-2026).
 *
 * JR pidio sacar del Deal Finder los 3 deals de 401 Biscayne Blvd, y el sync de Miami-Dade los volvia a crear al
 * dia siguiente: el conector trae siempre las mismas 50 parcelas del condado y esos folios estan entre ellas. Un
 * borrado a pedido no puede deshacerse solo. Los folios de FolioDescartado no se crean ni se actualizan en ninguna
 * ingesta de parcelas (ingestArcgisRecords, que usan los conectores y las semillas de distress). Crear un deal a
 * mano por la API sigue andando: es una decision explicita.
 *
 * El delegado puede faltar en un prisma de prueba: entonces no hay descartados.
 */
type DelegadoDescartados = {
  findMany: (args: { where: { parcelId: { in: string[] } }; select: { parcelId: true } }) => Promise<Array<{ parcelId: string }>>;
};

export async function foliosDescartados(prisma: PrismaService, folios: Array<string | null | undefined>): Promise<Set<string>> {
  const ids = [...new Set(folios.map((f) => (f ?? "").trim()).filter(Boolean))];
  const delegado = (prisma as unknown as { folioDescartado?: DelegadoDescartados }).folioDescartado;
  if (!ids.length || !delegado) return new Set();
  const filas = await delegado.findMany({ where: { parcelId: { in: ids } }, select: { parcelId: true } });
  return new Set(filas.map((f) => f.parcelId));
}
