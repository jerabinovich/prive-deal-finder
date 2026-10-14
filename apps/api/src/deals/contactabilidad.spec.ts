import { decidirOperacion } from "./operational-decision";
import type { EntradaDecision } from "./operational-decision";

/**
 * 13-oct-2026: la contactabilidad guardada era un pestillo: el primer valor calculado quedaba para siempre
 * (nadie la carga a mano), y un domicilio postal, un telefono o un correo nuevos no la cambiaban.
 */
function entrada(deal: EntradaDecision["deal"], owners: EntradaDecision["owners"] = []): EntradaDecision {
  return {
    deal: { parcelId: "0101000000010", address: "1 TEST ST", ...deal },
    owners,
    distressSignals: [],
    events: [],
    classification: "WATCHLIST" as EntradaDecision["classification"],
    completenessScore: 50,
    spreadToAskPct: null,
    comparableCount: 0,
  };
}

describe("contactabilidad: siempre desde los datos de hoy", () => {
  it("un domicilio postal nuevo sube la contactabilidad aunque haya un valor guardado", () => {
    expect(decidirOperacion(entrada({ contactabilityScore: 15, mailingAddress: null })).contactabilityScore).toBe(15);
    expect(decidirOperacion(entrada({ contactabilityScore: 15, mailingAddress: "1 MAIN ST, MIAMI, FL 33131" })).contactabilityScore).toBe(50);
  });

  it("telefono y correo del dueno tambien cuentan", () => {
    const d = decidirOperacion(entrada({ contactabilityScore: 15, mailingAddress: "X" }, [{ name: "A", phone: "305", email: "a@b.c" }]));
    expect(d.contactabilityScore).toBe(100);
  });
});
