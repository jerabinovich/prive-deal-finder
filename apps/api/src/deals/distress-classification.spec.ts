import {
  clasificarClaseCaso, clasificarBanda, leerCasoForeclosure,
  esForeclosureDeInteres, resumirCodeEnforcement, decidirDistress, esDemandanteConsorcio,
} from "./distress-classification";

const caso = (tipo: string, caption: string) =>
  JSON.stringify({ caseTypeCode: tipo, caption, metadata: { Case_Type: tipo, Caption: caption } });

const HOA = "Cricket Club Townhomes Homeowners' Association Inc         Plaintiff vs.  Margarita  Vasquez, et al         Defendant";
const BANCO = "Ages Mortgage Llc         Plaintiff vs.  Keith Reginald Timmons, et al         Defendant";

const violacion = (estado: string, problema: string) =>
  ({ source: "miami-dade-code-enforcement", metadata: JSON.stringify({ STAT_DESC: estado, PROBLEM_DESC: problema }) });
const violacionDeCaso = (caso: string, estado: string) =>
  ({ source: "miami-dade-code-enforcement", metadata: JSON.stringify({ CASE_NUM: caso, STAT_DESC: estado, PROBLEM_DESC: "Junk and trash" }) });

describe("clase de caso, sobre los textos reales de Broward", () => {
  it("distingue comercial, homestead y no homestead", () => {
    expect(clasificarClaseCaso("Real Prop Comm Fore $250,000 or More")).toBe("COMERCIAL");
    expect(clasificarClaseCaso("Real Prop Homestead Res Fore $250,000 or More")).toBe("RES_HOMESTEAD");
    expect(clasificarClaseCaso("Real Prop NonHomestead Res Fore $250,000 or More")).toBe("RES_NO_HOMESTEAD");
    expect(clasificarClaseCaso("Real Prop NHmstd Res Fore $50K to $250K")).toBe("RES_NO_HOMESTEAD");
    expect(clasificarClaseCaso("Real Prop Other Fore $50,000 or Less")).toBe("OTRO");
    expect(clasificarClaseCaso("Real Property/Mortgage Foreclosure $1 - $15,000")).toBe("OTRO");
  });
});

describe("banda de monto", () => {
  it("lee las cinco formas que usa Broward", () => {
    expect(clasificarBanda("Real Prop Comm Fore $250,000 or More")).toBe("DESDE_250K");
    expect(clasificarBanda("Real Prop Comm Fore Between $50,000 and $250,000")).toBe("ENTRE_50K_Y_250K");
    expect(clasificarBanda("Real Prop NHmstd Res Fore $50K to $250K")).toBe("ENTRE_50K_Y_250K");
    expect(clasificarBanda("Real Prop Other Fore $50,000 or Less")).toBe("HASTA_50K");
    expect(clasificarBanda("Real Property/Mortgage Foreclosure $1 - $15,000")).toBe("HASTA_50K");
    expect(clasificarBanda("Real Property/Mortgage Foreclosure $15,001 - $30,000")).toBe("HASTA_50K");
    expect(clasificarBanda("algo sin monto")).toBe("DESCONOCIDA");
  });
});

describe("la regla de negocio", () => {
  it("el consorcio ejecutando expensas NO es oportunidad, aunque sea comercial", () => {
    const c = leerCasoForeclosure(caso("Real Prop Comm Fore $50,000 or Less", HOA));
    expect(c.demandanteEsConsorcio).toBe(true);
    expect(esForeclosureDeInteres(c, "Condominia (DOR 04)")).toBe(false);
  });

  it("comercial de banco entra con cualquier monto", () => {
    for (const t of ["Real Prop Comm Fore $250,000 or More", "Real Prop Comm Fore Between $50,000 and $250,000"]) {
      expect(esForeclosureDeInteres(leerCasoForeclosure(caso(t, BANCO)), null)).toBe(true);
    }
  });

  it("residencial solo desde 250 mil", () => {
    expect(esForeclosureDeInteres(leerCasoForeclosure(caso("Real Prop Homestead Res Fore $250,000 or More", BANCO)), null)).toBe(true);
    expect(esForeclosureDeInteres(leerCasoForeclosure(caso("Real Prop Homestead Res Fore Between $50,000 and $250,000", BANCO)), null)).toBe(false);
    expect(esForeclosureDeInteres(leerCasoForeclosure(caso("Real Prop NonHomestead Res Fore $50,000 or Less", BANCO)), null)).toBe(false);
  });

  it("un caso Other lo decide el codigo DOR de la parcela: asi entra la tierra", () => {
    const c = leerCasoForeclosure(caso("Real Prop Other Fore $50,000 or Less", BANCO));
    expect(esForeclosureDeInteres(c, "VACANT LAND - COMMERCIAL : VACANT LAND")).toBe(true);
    expect(esForeclosureDeInteres(c, "MULTIFAMILY 2-9 UNITS : 2 LIVING UNITS")).toBe(true);
    expect(esForeclosureDeInteres(c, "Warehousing, distribution terminals, trucking terminals (DOR 48)")).toBe(true);
    expect(esForeclosureDeInteres(c, "RESIDENTIAL - SINGLE FAMILY : 1 UNIT")).toBe(false);
  });

  it("sin el dato que la regla necesita, no dispara", () => {
    expect(esForeclosureDeInteres(leerCasoForeclosure(caso("Real Prop Other Fore $50,000 or Less", BANCO)), null)).toBe(false);
    expect(esForeclosureDeInteres(leerCasoForeclosure(caso("", BANCO)), "VACANT")).toBe(false);
  });
});

describe("quien ejecuta: consorcio o prestamista, con demandantes reales de Broward", () => {
  it("un banco nacional NO es consorcio aunque se llame National Association", () => {
    for (const d of ["U S BANK NATIONAL ASSOCIATION", "JPMORGAN CHASE BANK  NATIONAL AS", "AMERANT BANK, N.A., A NATIONAL B",
      "US BANK TRUST NATIONAL ASSOCIATI", "U.S. BANK TRUST COMPANY, NATIONA"]) {
      expect(esDemandanteConsorcio(d)).toBe(false);
    }
  });

  it("los prestamistas comunes no son consorcio", () => {
    for (const d of ["AGES MORTGAGE LLC", "LAKEVIEW LOAN SERVICING LLC", "SPACE COAST CREDIT UNION", "CITIBANK, N.A.", "TIB  NA"]) {
      expect(esDemandanteConsorcio(d)).toBe(false);
    }
  });

  it("el consorcio cortado por Broward igual se reconoce", () => {
    for (const d of ["CORAL SPRINGS PROFESSIONAL CAMPUS MASTER ASSOCIATI", "SUNRISE LAKES CONDO APTS PHASE 3",
      "NASSAU VILLAGE WEST II ASSOCIATI", "VIZCAYA COMMUNIT ASSOCIATION INC", "ENVIRON CONDOMINIUM I ASSOCIATIO",
      "Cricket Club Townhomes Homeowners' Association Inc"]) {
      expect(esDemandanteConsorcio(d)).toBe(true);
    }
  });

  it("la ejecucion hipotecaria de un banco nacional, residencial desde 250 mil, entra", () => {
    const c = leerCasoForeclosure(caso("Real Prop Homestead Res Fore $250,000 or More",
      "U S BANK NATIONAL ASSOCIATION         Plaintiff vs.  Jane Roe, et al         Defendant"));
    expect(c.demandanteEsConsorcio).toBe(false);
    expect(esForeclosureDeInteres(c, null)).toBe(true);
  });

  it("el consorcio de un campus de oficinas ejecutando expensas no entra, aunque sea comercial", () => {
    const c = leerCasoForeclosure(caso("Real Prop Comm Fore $50,000 or Less",
      "CORAL SPRINGS PROFESSIONAL CAMPUS MASTER ASSOCIATI         Plaintiff vs.  FORSA LIGHT LLC, et al         Defendant"));
    expect(c.demandanteEsConsorcio).toBe(true);
    expect(esForeclosureDeInteres(c, null)).toBe(false);
  });
});

describe("code enforcement", () => {
  it("cuenta solo los estados vigentes reales", () => {
    const r = resumirCodeEnforcement([
      violacion("Lien", "Junk/Trash/Overgrowth on Unimproved/Improved Prop"),
      violacion("Open", "Graffiti"),
      violacion("Referred to Internal Compliance", "Vacation Rental"),
      violacion("Closed", "Graffiti"),
    ]);
    expect(r.vigentes).toBe(3);
  });

  it("marca la bandera de REO sin mandarla a pre foreclosure", () => {
    const r = resumirCodeEnforcement([violacion("Lien", "Failure to Register Foreclosed Property")]);
    expect(r.reoPosible).toBe(true);
    const d = decidirDistress([violacion("Lien", "Failure to Register Foreclosed Property")], null);
    expect(d.stage).not.toBe("PRE_FORECLOSURE");
    expect(d.reoPosible).toBe(true);
  });
});

describe("la decision final, que es la que veran el carril y el puntaje", () => {
  it("un foreclosure serio manda a PRE_FORECLOSURE", () => {
    const d = decidirDistress(
      [{ source: "broward-foreclosure", metadata: caso("Real Prop Comm Fore $250,000 or More", BANCO) }], null);
    expect(d.stage).toBe("PRE_FORECLOSURE");
    expect(d.foreclosuresDeInteres).toBe(1);
  });

  it("una ejecucion de expensas NO manda a PRE_FORECLOSURE", () => {
    const d = decidirDistress(
      [{ source: "broward-foreclosure", metadata: caso("Real Prop Other Fore $50,000 or Less", HOA) }], null);
    expect(d.stage).toBe("SIGNALS_ONLY");
    expect(d.foreclosuresDescartados).toBe(1);
  });

  it("tres violaciones vigentes son senal blanda, dos no alcanzan", () => {
    const tres = [violacion("Lien", "Graffiti"), violacion("Lien", "Graffiti"), violacion("Open", "Graffiti")];
    expect(decidirDistress(tres, null).stage).toBe("SIGNALS_ONLY");
    expect(decidirDistress(tres.slice(0, 2), null).codeEnforcementVigentes).toBe(2);
  });

  it("la misma violacion guardada varias veces cuenta una sola vez", () => {
    const repetida = Array.from({ length: 5 }, () => violacionDeCaso("202609000123", "Lien"));
    expect(resumirCodeEnforcement(repetida).vigentes).toBe(1);
    expect(decidirDistress(repetida, null).motivo).toBe("violaciones de codigo aisladas");
  });

  it("tres casos distintos vigentes si son senal blanda", () => {
    const tres = ["202601000001", "202602000002", "202603000003"].map((c) => violacionDeCaso(c, "Lien"));
    expect(resumirCodeEnforcement(tres).vigentes).toBe(3);
    expect(decidirDistress(tres, null).motivo).toBe("3 violaciones de codigo vigentes");
  });

  it("sin senales, NONE", () => {
    expect(decidirDistress([], null).stage).toBe("NONE");
  });
});
