import type { PrismaClient } from "@prisma/client";
import { computeDealCompletenessScore, esFuenteDeParcelas } from "../deals/deals.utils";

/**
 * PARCELAS SIN PRECIO PEDIDO (25-oct-2026, decision de JR).
 *
 * askingPrice solo existe en listings y brokers. En las parcelas del condado quedaba la tasacion o la ultima venta
 * copiada como si fuera un precio pedido (y el precio por sqft calculado de ahi). La tasacion y la venta siguen como
 * referencia, con su fuente, en MdpaAssessment y MdpaSale. Este paso vacia askingPrice y pricePerSqft de las parcelas
 * y recalcula la completitud con la cuenta unica (computeDealCompletenessScore), que en parcelas ya no los pide.
 *
 * Los mismos tres pasos que el recalculo unico (recalculo-unico.ts): planear sin escribir; aplicar solo si la fila
 * sigue con el valor planeado; restaurar solo lo que aplicar escribio.
 */
export type ValoresPrecio = { askingPrice: number | null; pricePerSqft: number | null; dataCompletenessScore: number };
export type CambioPrecio = { id: string; source: string | null; antes: ValoresPrecio; despues: ValoresPrecio };

const CAMPOS = {
  id: true, source: true, parcelId: true, address: true, city: true, zip: true, propertyUseCode: true, lotSizeSqft: true,
  buildingSizeSqft: true, yearBuilt: true, zoning: true, askingPrice: true, pricePerSqft: true, latitude: true,
  longitude: true, dataCompletenessScore: true,
} as const;
type DealPrecio = {
  id: string; source: string | null; parcelId: string | null; address: string | null; city: string | null; zip: string | null;
  propertyUseCode: string | null; lotSizeSqft: number | null; buildingSizeSqft: number | null; yearBuilt: number | null;
  zoning: string | null; askingPrice: number | null; pricePerSqft: number | null; latitude: number | null;
  longitude: number | null; dataCompletenessScore: number;
};

export function valoresDeHoyPrecio(d: DealPrecio): ValoresPrecio {
  return {
    askingPrice: null,
    pricePerSqft: null,
    dataCompletenessScore: computeDealCompletenessScore({ ...d, askingPrice: null, pricePerSqft: null }),
  };
}

const iguales = (a: ValoresPrecio, b: ValoresPrecio) =>
  a.askingPrice === b.askingPrice && a.pricePerSqft === b.pricePerSqft && a.dataCompletenessScore === b.dataCompletenessScore;

/** Las parcelas (*-parcels y mdpa, o las fuentes indicadas) cuyo precio o completitud no son los de la regla de hoy. */
export async function planearPrecio(prisma: Pick<PrismaClient, "deal">, fuentes?: string[]): Promise<CambioPrecio[]> {
  const deals = (await prisma.deal.findMany({
    where: fuentes?.length ? { source: { in: fuentes } } : { OR: [{ source: { endsWith: "-parcels" } }, { source: "mdpa" }] },
    select: CAMPOS,
  })) as unknown as DealPrecio[];
  const cambios: CambioPrecio[] = [];
  for (const d of deals) {
    // Una fuente pedida a mano que no es de parcelas no se toca: alli el askingPrice es un precio pedido real.
    if (!esFuenteDeParcelas(d.source)) continue;
    const antes: ValoresPrecio = { askingPrice: d.askingPrice, pricePerSqft: d.pricePerSqft, dataCompletenessScore: d.dataCompletenessScore };
    const despues = valoresDeHoyPrecio(d);
    if (!iguales(antes, despues)) cambios.push({ id: d.id, source: d.source, antes, despues });
  }
  return cambios;
}

export type RegistroPrecio = {
  antes?: (id: string) => void;
  salteado?: (id: string) => void;
  escrito?: (id: string) => void;
  /** Valor de hoy de la fila con las entradas del momento; si no coincide con el que se va a escribir, se saltea. */
  vigente?: (id: string) => Promise<ValoresPrecio | null>;
};

async function escribir(
  prisma: Pick<PrismaClient, "deal">, cambios: CambioPrecio[], de: "antes" | "despues", a: "antes" | "despues",
  registro: RegistroPrecio = {},
) {
  let escritos = 0;
  let saltados = 0;
  for (const c of cambios) {
    if (registro.vigente) {
      const hoy = await registro.vigente(c.id);
      if (!hoy || !iguales(hoy, c[a])) {
        saltados += 1;
        registro.salteado?.(c.id);
        continue;
      }
    }
    registro.antes?.(c.id);
    const r = await prisma.deal.updateMany({
      where: { id: c.id, askingPrice: c[de].askingPrice, pricePerSqft: c[de].pricePerSqft, dataCompletenessScore: c[de].dataCompletenessScore },
      data: { askingPrice: c[a].askingPrice, pricePerSqft: c[a].pricePerSqft, dataCompletenessScore: c[a].dataCompletenessScore },
    });
    if (r.count === 1) {
      escritos += 1;
      registro.escrito?.(c.id);
    } else {
      saltados += 1;
      registro.salteado?.(c.id);
    }
  }
  return { escritos, saltados };
}

export async function vigentePrecio(prisma: Pick<PrismaClient, "deal">, id: string): Promise<ValoresPrecio | null> {
  const d = (await prisma.deal.findUnique({ where: { id }, select: CAMPOS })) as unknown as DealPrecio | null;
  return d ? valoresDeHoyPrecio(d) : null;
}

export const aplicarPrecio = (prisma: Pick<PrismaClient, "deal">, cambios: CambioPrecio[], registro?: RegistroPrecio) =>
  escribir(prisma, cambios, "antes", "despues", registro);

/**
 * Vuelve a los valores de antes, solo en las filas que aplicar escribio y no restauradas ya. Restaurar en el aire no
 * sirve si la ingesta nueva ya esta desplegada: la proxima sincronizacion vuelve a vaciar el precio.
 */
export const restaurarPrecio = (
  prisma: Pick<PrismaClient, "deal">, cambios: CambioPrecio[], aplicados: string[],
  registro: { yaRestaurados?: string[]; alRestaurar?: (id: string) => void } = {},
) => {
  const ids = new Set(aplicados);
  const ya = new Set(registro.yaRestaurados ?? []);
  return escribir(prisma, cambios.filter((c) => ids.has(c.id) && !ya.has(c.id)), "despues", "antes", { escrito: registro.alRestaurar });
};

/** Resumen para la prueba: cuantas filas por fuente y cuanto sube o baja la completitud. */
export function resumenPrecio(cambios: CambioPrecio[]) {
  const porFuente: Record<string, number> = {};
  const completitud: Record<string, number> = {};
  let vacianPrecio = 0;
  for (const c of cambios) {
    porFuente[c.source ?? "sin fuente"] = (porFuente[c.source ?? "sin fuente"] || 0) + 1;
    const d = Math.round(c.despues.dataCompletenessScore - c.antes.dataCompletenessScore);
    const clave = d > 0 ? `+${d}` : `${d}`;
    completitud[clave] = (completitud[clave] || 0) + 1;
    if (c.antes.askingPrice !== null || c.antes.pricePerSqft !== null) vacianPrecio += 1;
  }
  return { cambios: cambios.length, vacianPrecio, porFuente, completitud };
}
