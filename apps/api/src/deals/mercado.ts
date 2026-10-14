/**
 * MERCADO CANONICO (13-oct-2026).
 *
 * Los deals que carga Amanda desde correos de brokers traian el mercado como texto libre: "South Florida -
 * Miami-Dade (Little Havana)". Ese texto los dejaba fuera de los filtros por mercado y de la consulta de
 * deuda del Clerk, que solo mira los deals de "Miami-Dade" (miami-dade-clerk.debt.ts). El mercado pasa al
 * nombre que usan las ingestas de parcelas y el barrio entre parentesis pasa a submarket, si no vino uno.
 * Un texto que no nombra un condado conocido queda como vino.
 */
const CANONICOS: Array<[RegExp, string]> = [
  [/MIAMI[\s-]*DADE|\bDADE\b/i, "Miami-Dade"],
  [/BROWARD/i, "Broward"],
  [/PALM\s*BEACH/i, "Palm Beach"],
];

export function normalizarMercado(
  market?: string | null,
  submarket?: string | null,
): { market?: string; submarket?: string } {
  const texto = (market ?? "").trim();
  const sub = (submarket ?? "").trim();
  if (!texto) return { market: market ?? undefined, submarket: submarket ?? undefined };
  const canonico = CANONICOS.find(([re]) => re.test(texto))?.[1];
  if (!canonico) return { market: texto, submarket: sub || undefined };
  const barrio = texto.match(/\(([^()]+)\)\s*$/)?.[1]?.trim();
  return { market: canonico, submarket: sub || barrio || undefined };
}
