/**
 * --limite N de los scripts de apps/api/scripts (25-oct-2026). Antes cada script hacia Number(args[i + 1]): sin numero
 * daba NaN, el `...(limite ? { take } : {})` lo tomaba como falso y la corrida seguia SIN tope (con --aplicar escribia
 * en todos los deals). Ahora un valor que no es un entero positivo corta la corrida antes de abrir la base.
 */
export function leerLimite(args: string[]): number | undefined {
  const i = args.indexOf("--limite");
  if (i < 0) return undefined;
  const crudo = args[i + 1];
  const n = Number(crudo);
  if (!crudo || crudo.startsWith("--") || !Number.isInteger(n) || n <= 0) {
    throw new Error(`--limite necesita un entero positivo (vino: ${crudo ?? "nada"})`);
  }
  return n;
}
