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
    // Por defecto, las fuentes de parcelas (*-parcels) y mdpa, que tambien crea deals de parcelas (mdpa.ingest.ts).
    where: fuentes?.length ? { source: { in: fuentes } } : { OR: [{ source: { endsWith: "-parcels" } }, { source: "mdpa" }] },
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

/**
 * Registro de aplicar: antes(id) se llama ANTES de escribir la fila y salteado(id) despues, si la guarda no la dejo
 * escribir. Asi, aunque el proceso se corte entre la escritura y el registro, toda fila que pudo quedar escrita esta
 * anotada; restaurar la vuelve atras solo si sigue con el valor nuevo (revision de Codex del PR 22).
 */
export type RegistroAplicar = { antes?: (id: string) => void; salteado?: (id: string) => void };

async function escribir(
  prisma: Pick<PrismaClient, "deal">,
  cambios: Cambio[],
  de: "antes" | "despues",
  a: "antes" | "despues",
  registro: RegistroAplicar = {},
) {
  let escritos = 0;
  let saltados = 0;
  for (const c of cambios) {
    registro.antes?.(c.id);
    const r = await prisma.deal.updateMany({
      where: { id: c.id, score: c[de].score, isNoise: c[de].isNoise, noiseReason: c[de].noiseReason as never },
      data: { score: c[a].score, isNoise: c[a].isNoise, noiseReason: c[a].noiseReason as never },
    });
    if (r.count === 1) escritos += 1;
    else {
      saltados += 1;
      registro.salteado?.(c.id);
    }
  }
  return { escritos, saltados };
}

/** Del registro (lineas "intento <id>" y "salteado <id>"), las filas que restaurar puede tener que volver atras. */
export function filasARestaurar(lineas: string[]): string[] {
  const salteados = new Set(lineas.filter((l) => l.startsWith("salteado ")).map((l) => l.slice(9).trim()));
  return lineas.filter((l) => l.startsWith("intento ")).map((l) => l.slice(8).trim()).filter((id) => id && !salteados.has(id));
}

/** Escribe los valores nuevos; un deal que cambio desde que se planeo se saltea (y se cuenta y se anota). */
export const aplicar = (prisma: Pick<PrismaClient, "deal">, cambios: Cambio[], registro?: RegistroAplicar) =>
  escribir(prisma, cambios, "antes", "despues", registro);

/**
 * Vuelve a los valores de antes, SOLO en las filas que el aplicado escribio (aplicados, del registro): una fila que el
 * aplicado salteo porque otro proceso ya la habia puesto en el mismo valor no se toca (revision de Codex del PR 22).
 */
export const restaurar = (prisma: Pick<PrismaClient, "deal">, cambios: Cambio[], aplicados: string[]) => {
  const ids = new Set(aplicados);
  return escribir(prisma, cambios.filter((c) => ids.has(c.id)), "despues", "antes");
};

/**
 * Opciones de scripts/recalcular-puntajes.js. Una opcion que pide valor y viene sin el (o seguida de otra opcion) es
 * un error: antes "--fuente" al final quedaba sin filtro y la corrida tomaba todas las fuentes de parcelas.
 */
export function leerArgumentos(args: string[]): { aplicar: boolean; respaldo?: string; restaurar?: string; fuentes: string[] } {
  const valorDe = (i: number, op: string) => {
    const v = args[i + 1];
    if (!v || v.startsWith("--")) throw new Error(`${op} necesita un valor`);
    return v;
  };
  const fuentes: string[] = [];
  let respaldo: string | undefined;
  let restaurar: string | undefined;
  // Revision de Codex del PR 22: una opcion desconocida (por ejemplo --fuent) es un error, no un filtro que se pierde.
  const conValor = new Set(["--fuente", "--respaldo", "--restaurar"]);
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--aplicar") continue;
    if (!conValor.has(a)) throw new Error(`opcion desconocida: ${a}`);
    const v = valorDe(i, a);
    if (a === "--fuente") fuentes.push(v);
    if (a === "--respaldo") respaldo = v;
    if (a === "--restaurar") restaurar = v;
    i += 1;
  }
  return { aplicar: args.includes("--aplicar"), respaldo, restaurar, fuentes };
}
