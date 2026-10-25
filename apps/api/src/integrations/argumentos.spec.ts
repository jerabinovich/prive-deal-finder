import { leerLimite } from "./argumentos";

describe("leerLimite (25-oct)", () => {
  it("sin --limite: sin tope", () => {
    expect(leerLimite(["--aplicar"])).toBeUndefined();
  });
  it("--limite N: N", () => {
    expect(leerLimite(["--aplicar", "--limite", "50"])).toBe(50);
  });
  it("--limite sin numero, con texto, cero, negativo o decimal: error, nunca correr sin tope", () => {
    for (const malo of [["--limite"], ["--limite", "--aplicar"], ["--limite", "diez"], ["--limite", "0"], ["--limite", "-5"], ["--limite", "2.5"]]) {
      expect(() => leerLimite(malo)).toThrow(/--limite/);
    }
  });
});
