import type { PrismaClient } from "@prisma/client";
import { decidirDistress } from "../deals/distress-classification";
import { computeTriageScore } from "../scoring/score";

type DealGuardado = {
  assetType: string | null; propertyUseCode: string | null; mailingAddress: string | null; city: string | null;
  municipality: string | null; state: string | null; yearBuilt: number | null; lotSizeSqft: number | null; source: string | null;
};

/** Lo que computeTriageScore lee de un deal guardado y sus duenos, salvo la etapa de distress. */
function entradaDeTriage(deal: DealGuardado, ownerNames: string[]) {
  return {
    assetType: deal.assetType,
    propertyUseCode: deal.propertyUseCode,
    ownerNames,
    mailingAddress: deal.mailingAddress,
    city: deal.city,
    municipality: deal.municipality,
    state: deal.state,
    yearBuilt: deal.yearBuilt,
    lotSizeSqft: deal.lotSizeSqft,
    source: deal.source,
  };
}

const nombresDe = (owners: Array<{ owner: { name: string | null } | null }>) =>
  owners.map((item) => item.owner?.name).filter((name): name is string => Boolean(name));

/**
 * Recalcula la etapa de distress y el score de los deals indicados mirando TODAS sus senales.
 *
 * POR QUE HACE FALTA: el score se calcula en la INGESTA de la parcela, cuando todavia no hay senales.
 * Sin este paso, un multifamily con un lien registrado puntuaba igual que uno sin nada.
 *
 * 28-sep-2026: la etapa la decide decidirDistress leyendo el expediente (no el nombre de la fuente),
 * se GUARDA en distressStage, y se miran todas las senales del deal para que dos sincronizaciones
 * distintas no se pisen la clasificacion.
 *
 * 13-oct-2026: sale de integrations.service.ts sin cambios para que la reparacion de folios de Broward
 * use exactamente la misma cuenta. Un deal que se quedo sin senales tambien se recalcula: vuelve a su
 * puntaje de parcela y a etapa NONE. En la sincronizacion normal todos los ids traen senales, asi que
 * ahi no cambia nada.
 */
export async function recalcularDistressYPuntaje(prisma: PrismaClient, ids: string[]): Promise<number> {
  const unicos = [...new Set(ids)];
  if (!unicos.length) return 0;

  const signals = await prisma.dealDistressSignal.findMany({
    where: { dealId: { in: unicos } },
    select: { dealId: true, source: true, metadata: true },
  });
  const porDeal = new Map<string, Array<{ source: string | null; metadata: string | null }>>(
    unicos.map((id) => [id, []]),
  );
  for (const s of signals) porDeal.get(s.dealId)?.push({ source: s.source, metadata: s.metadata });

  let updated = 0;
  for (const [dealId, senales] of porDeal) {
    const deal = await prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal) continue;

    const owners = await prisma.dealOwner.findMany({
      where: { dealId },
      select: { owner: { select: { name: true } } },
    });

    const decision = decidirDistress(senales, deal.propertyUseCode);

    const triage = computeTriageScore({ ...entradaDeTriage(deal, nombresDe(owners)), distressStage: decision.stage });

    if (
      triage.score === deal.score &&
      triage.isNoise === deal.isNoise &&
      deal.distressStage === decision.stage
    ) continue;

    await prisma.deal.update({
      where: { id: dealId },
      data: {
        score: triage.score,
        isNoise: triage.isNoise,
        noiseReason: triage.noiseReason,
        distressStage: decision.stage,
      },
    });
    updated += 1;
  }
  return updated;
}

/**
 * Recalcula SOLO el score (y el ruido) de los deals indicados, con la etapa de distress que ya tienen guardada
 * (25-oct-2026). Es la misma cuenta que hace la ingesta de parcelas (arcgis.ingest.ts usa deal.distressStage), para
 * cuando otro paso cambia un dato del score, como el lote que carga catastro-valores.ts.
 *
 * POR QUE NO recalcularDistressYPuntaje: esa decide la etapa solo con las senales; GOVERNMENT_LAND lo pone el triage
 * (operational-decision.ts) por dueno o uso del suelo y no tiene senales. Medido el 25-oct: los 941 deals con
 * GOVERNMENT_LAND y sin senales pasarian a NONE.
 */
export async function recalcularPuntaje(prisma: Pick<PrismaClient, "deal" | "dealOwner">, ids: string[]): Promise<number> {
  let updated = 0;
  for (const dealId of [...new Set(ids)]) {
    const deal = await prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal) continue;
    const owners = await prisma.dealOwner.findMany({ where: { dealId }, select: { owner: { select: { name: true } } } });
    const triage = computeTriageScore({ ...entradaDeTriage(deal, nombresDe(owners)), distressStage: deal.distressStage });
    if (triage.score === deal.score && triage.isNoise === deal.isNoise && triage.noiseReason === deal.noiseReason) continue;
    await prisma.deal.update({
      where: { id: dealId },
      data: { score: triage.score, isNoise: triage.isNoise, noiseReason: triage.noiseReason },
    });
    updated += 1;
  }
  return updated;
}
