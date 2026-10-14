import { normalizarMercado } from "./mercado";

describe("mercado canonico", () => {
  it("el texto libre de un broker pasa al condado y el barrio a submarket", () => {
    expect(normalizarMercado("South Florida - Miami-Dade (Little Havana)")).toEqual({ market: "Miami-Dade", submarket: "Little Havana" });
    expect(normalizarMercado("Broward County", null)).toEqual({ market: "Broward", submarket: undefined });
    expect(normalizarMercado("West Palm Beach (Downtown)", "CityPlace")).toEqual({ market: "Palm Beach", submarket: "CityPlace" });
    expect(normalizarMercado("Miami Dade")).toEqual({ market: "Miami-Dade", submarket: undefined });
  });

  it("lo canonico y lo desconocido quedan como estan", () => {
    expect(normalizarMercado("Miami-Dade", "Brickell")).toEqual({ market: "Miami-Dade", submarket: "Brickell" });
    expect(normalizarMercado("  Orlando  ")).toEqual({ market: "Orlando", submarket: undefined });
    expect(normalizarMercado(undefined, undefined)).toEqual({ market: undefined, submarket: undefined });
  });
});
