import { decidirOperacion } from "./operational-decision";
import type { EntradaDecision } from "./operational-decision";
import { DealsService } from "./deals.service";
import { DealsTriageService } from "./deals-triage.service";

/**
 * 10-oct-2026: una sola decision de carril. Antes DealsService tenia su propia copia, con el pestillo
 * de ruido (lo guardado ganaba siempre), y seis terrenos publicos del downtown no salian nunca del
 * carril de ruido aunque la regla ya los mandaba a P3.
 */
function entrada(deal: EntradaDecision["deal"]): EntradaDecision {
  return {
    deal: { parcelId: "0101000000010", address: "1 TEST ST", ...deal },
    owners: [],
    distressSignals: [],
    events: [],
    classification: "WATCHLIST" as EntradaDecision["classification"],
    completenessScore: 50,
    spreadToAskPct: null,
    comparableCount: 0,
  };
}

const TIERRA_PUBLICA = "VACANT GOVERNMENTAL : VACANT LAND";

describe("decidirOperacion: una sola decision de carril, sin pestillo de ruido", () => {
  it("25-oct-2026 (JR): tierra publica vacante es ruido GOVERNMENT, con su motivo y no el guardado", () => {
    const d = decidirOperacion(entrada({ propertyUseCode: TIERRA_PUBLICA, assetType: TIERRA_PUBLICA, isNoise: true, noiseReason: "UNKNOWN" }));
    expect(d).toMatchObject({ isNoise: true, noiseReason: "GOVERNMENT", lane: "NON_ACQUIRABLE_NOISE", recommendedAction: "ARCHIVE" });
  });

  it("una calle sigue siendo ruido aunque no estuviera marcada", () => {
    const uso = "Right-of-way, streets, roads, irrigation channel, ditch, etc. (DOR 94)";
    const d = decidirOperacion(entrada({ propertyUseCode: uso, assetType: uso, isNoise: false, noiseReason: null }));
    expect(d.isNoise).toBe(true);
    expect(d.lane).toBe("NON_ACQUIRABLE_NOISE");
  });

  it("el ruido guardado no se hereda: un local comercial vuelve a evaluarse", () => {
    const uso = "Stores, one story (DOR 11)";
    const d = decidirOperacion(entrada({ propertyUseCode: uso, assetType: uso, isNoise: true, noiseReason: "UNKNOWN" }));
    expect(d.isNoise).toBe(false);
    expect(d.lane).not.toBe("NON_ACQUIRABLE_NOISE");
  });

  it("DealsService y DealsTriageService devuelven exactamente la misma decision", () => {
    const e = entrada({ propertyUseCode: TIERRA_PUBLICA, assetType: TIERRA_PUBLICA, isNoise: true, noiseReason: "UNKNOWN" });
    const esperado = decidirOperacion(e);
    const servicio = (Object.create(DealsService.prototype) as any).computeOperationalDecision(e);
    const triage = (Object.create(DealsTriageService.prototype) as any).computeOperationalDecision(e);
    expect(servicio).toEqual(esperado);
    expect(triage).toEqual(esperado);
  });
});
