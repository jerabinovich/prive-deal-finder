import type { PrismaClient } from "@prisma/client";
import { computeTriageScore } from "../scoring/score";
import { entradaDeTriage } from "./rescore-distress";

/**
 * RECALCULO UNICO DE SCORES (25-oct-2026, OK de JR).
 *
 * Medido el 25-oct: de 15.524 parcelas con lote, 4.255 tenian el score guardado distinto del que da la formula de hoy
 * (cambios de la formula y senales borradas sin recalcular). Esto los pone al dia con la misma cuenta que la ingesta
 * de parcelas y recalcularPuntaje: computeTriageScore con la etapa de distress GUARDADA (no se toca la etapa).
 *
 * Tres pasos separados y repetibles, para poder probarlos y volver atras:
 *   planear: calcula que cambiaria, sin escribir.
 *   aplicar: escribe el valor nuevo solo si el guardado sigue siendo el que se planeo (no pisa un cambio concurrente).
 *   restaurar: vuelve al valor anterior, con la misma guarda (solo si sigue el valor que escribio aplicar).
 */
export type Valores = { score: number | null; isNoise: boolean; noiseReason: string | null };
export type Cambio = { id: string; antes: Valores; despues: Valores };

type DealParaRecalculo = {
  id: string; assetType: string | null; propertyUseCode: string | null; mailingAddress: string | null; city: string | null;
  municipality: string | null; state: string | null; yearBuilt: number | null; lotSizeSqft: number | null; source: string | null;
  distressStage: string | null; score: number | null; isNoise: boolean; noiseReason: string | null;
  owners: Array<{ owner: { name: string | null } | null }>;
};

export function valoresDeHoy(d: DealParaRecalculo): Valores {
  // La misma entrada que recalcularPuntaje (entradaDeTriage), con la etapa de distress guardada.
  const nombres = d.owners.map((o) => o.owner?.name).filter((n): n is string => Boolean(n));
  const t = computeTriageScore({ ...entradaDeTriage(d, nombres), distressStage: d.distressStage as never });
  return { score: t.score, isNoise: t.isNoise, noiseReason: t.noiseReason };
}

const iguales = (a: Valores, b: Valores) => a.score === b.score && a.isNoise === b.isNoise && a.noiseReason === b.noiseReason;

/** Deals de las fuentes de parcelas (o de las indicadas) cuyo score guardado no coincide con la formula de hoy. */
export async function planear(prisma: Pick<PrismaClient, "deal">, fuentes?: string[]): Promise<Cambio[]> {
  const deals = (await prisma.deal.findMany({
    where: fuentes?.length ? { source: { in: fuentes } } : { source: { endsWith: "-parcels" } },
    select: {
      id: true, assetType: true, propertyUseCode: true, mailingAddress: true, city: true, municipality: true, state: true,
      yearBuilt: true, lotSizeSqft: true, source: true, distressStage: true, score: true, isNoise: true, noiseReason: true,
      owners: { select: { owner: { select: { name: true } } } },
    },
  })) as unknown as DealParaRecalculo[];
  const cambios: Cambio[] = [];
  for (const d of deals) {
    const antes: Valores = { score: d.score, isNoise: d.isNoise, noiseReason: d.noiseReason };
    const despues = valoresDeHoy(d);
    if (!iguales(antes, despues)) cambios.push({ id: d.id, antes, despues });
  }
  return cambios;
}

async function escribir(prisma: Pick<PrismaClient, "deal">, cambios: Cambio[], de: "antes" | "despues", a: "antes" | "despues") {
  let escritos = 0;
  let saltados = 0;
  for (const c of cambios) {
    const r = await prisma.deal.updateMany({
      where: { id: c.id, score: c[de].score, isNoise: c[de].isNoise, noiseReason: c[de].noiseReason as never },
      data: { score: c[a].score, isNoise: c[a].isNoise, noiseReason: c[a].noiseReason as never },
    });
    if (r.count === 1) escritos += 1;
    else saltados += 1;
  }
  return { escritos, saltados };
}

/** Escribe los valores nuevos; un deal que cambio desde que se planeo se saltea (y se cuenta). */
export const aplicar = (prisma: Pick<PrismaClient, "deal">, cambios: Cambio[]) => escribir(prisma, cambios, "antes", "despues");

/** Vuelve a los valores de antes; un deal que cambio despues de aplicar se saltea (y se cuenta). */
export const restaurar = (prisma: Pick<PrismaClient, "deal">, cambios: Cambio[]) => escribir(prisma, cambios, "despues", "antes");
