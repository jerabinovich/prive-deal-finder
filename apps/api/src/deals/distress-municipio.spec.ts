import { decidirDistress, esDemandanteMunicipio, esForeclosureDeInteres, leerCasoForeclosure } from "./distress-classification";

const caso = (tipo: string, caption: string) =>
  JSON.stringify({ caseTypeCode: tipo, caption, metadata: { Case_Type: tipo, Caption: caption } });
const foreclosure = (tipo: string, caption: string) => ({ source: "broward-foreclosure", metadata: caso(tipo, caption) });

// Los captions reales del 15 oct.
const WILTON = " CITY OF WILTON MANORS Plaintiff vs. ANDREWS AVE RETAIL LLC, et al Defendant";
const DAVIE = "TOWN OF DAVIE, A FLORIDA MUNICIPAL CORPORATION Plaintiff vs. X, et al Defendant";
const CITY_NATIONAL = "CITY NATIONAL BANK OF FLORIDA Plaintiff vs. NARANG PLAZA POMPANO, INC., et al Defendant";
const COMERCIAL = "Real Prop Comm Fore Between $50,000 and $250,000";

describe("la demanda de un municipio es senal blanda (JR, 15 oct)", () => {
  it("reconoce City of, Town of y Village of, pero no a un banco con City en el nombre", () => {
    expect(esDemandanteMunicipio("CITY OF WILTON MANORS")).toBe(true);
    expect(esDemandanteMunicipio("TOWN OF DAVIE, A FLORIDA MUNICIPAL CORPORATION")).toBe(true);
    expect(esDemandanteMunicipio("Village of Pinecrest")).toBe(true);
    expect(esDemandanteMunicipio("CITY NATIONAL BANK OF FLORIDA")).toBe(false);
    expect(esDemandanteMunicipio("U S BANK NATIONAL ASSOCIATION")).toBe(false);
  });

  it("un foreclosure comercial de City of Wilton Manors no es de interes; el de City National Bank si", () => {
    const wilton = leerCasoForeclosure(caso(COMERCIAL, WILTON));
    expect(wilton.demandanteEsMunicipio).toBe(true);
    expect(esForeclosureDeInteres(wilton, "Stores, one story (DOR 11)")).toBe(false);
    expect(esForeclosureDeInteres(leerCasoForeclosure(caso("Real Prop Comm Fore $250,000 or More", CITY_NATIONAL)), null)).toBe(true);
  });

  it("la etapa queda en SIGNALS_ONLY y el motivo lo dice; con una hipoteca al lado, manda la hipoteca", () => {
    const d = decidirDistress([foreclosure(COMERCIAL, WILTON)], "Stores, one story (DOR 11)");
    expect(d.stage).toBe("SIGNALS_ONLY");
    expect(d.motivo).toContain("1 de un municipio (senal blanda)");
    const conBanco = decidirDistress(
      [foreclosure(COMERCIAL, WILTON), foreclosure("Real Prop Comm Fore $250,000 or More", CITY_NATIONAL)],
      "Stores, one story (DOR 11)",
    );
    expect(conBanco.stage).toBe("PRE_FORECLOSURE");
    expect(decidirDistress([foreclosure("Real Prop NHmstd Res Fore $50K to $250K", DAVIE)], null).stage).toBe("SIGNALS_ONLY");
  });
});
