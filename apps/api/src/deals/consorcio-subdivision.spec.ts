import { demandanteEsDeLaSubdivision, esForeclosureDeInteres, leerCasoForeclosure } from "./distress-classification";

describe("consorcio que demanda con el nombre del edificio", () => {
  it("el demandante lleva todas las palabras propias de la subdivision o el condominio", () => {
    expect(demandanteEsDeLaSubdivision("CHAPEL TRAIL TRADE CENTER INC", "CHAPEL TRAIL TRADE CENTER")).toBe(true);
    expect(demandanteEsDeLaSubdivision("HALLANDALE TOWERS EAST, INC.", "HALLANDALE TOWERS EAST CONDO")).toBe(true);
    expect(demandanteEsDeLaSubdivision("Haven House No 5", "HAVEN HOUSE NO 5 CONDO")).toBe(true);
  });

  it("un prestamista o un gobierno nunca es el consorcio, aunque compartan palabras", () => {
    expect(demandanteEsDeLaSubdivision("CHAPEL TRAIL TRADE CENTER BANK", "CHAPEL TRAIL TRADE CENTER")).toBe(false);
    expect(demandanteEsDeLaSubdivision("CITY OF WILTON MANORS", "WILTON MANORS")).toBe(false);
  });

  it("una empresa que agrega una palabra de negocio al nombre del lugar no es el consorcio", () => {
    expect(demandanteEsDeLaSubdivision("CHAPEL TRAIL CAPITAL LLC", "CHAPEL TRAIL")).toBe(false);
    expect(demandanteEsDeLaSubdivision("PROGRESSO INVESTMENTS LLC", "PROGRESSO")).toBe(false);
    expect(demandanteEsDeLaSubdivision("PALM AIRE VILLAGE HOLDINGS INC", "PALM AIRE VILLAGE")).toBe(false);
    expect(demandanteEsDeLaSubdivision("PALM AIRE VILLAGE EAST INC", "PALM AIRE VILLAGE")).toBe(true);
    expect(demandanteEsDeLaSubdivision("PROGRESSO INC", "PROGRESSO")).toBe(true);
  });

  it("no alcanza con compartir una parte, ni con un nombre corto de una palabra", () => {
    expect(demandanteEsDeLaSubdivision("FRANKLIN CAPITAL LLC", "FRANKLIN PARK 21-3 B")).toBe(false);
    expect(demandanteEsDeLaSubdivision("JOHN WATERCREST", "WATERCREST-42 ACRES 181-194 B")).toBe(false);
    expect(demandanteEsDeLaSubdivision("PARK INC", "PARK")).toBe(false);
    expect(demandanteEsDeLaSubdivision("ANY NAME", "27-49-42")).toBe(false);
    expect(demandanteEsDeLaSubdivision("ANY NAME", null)).toBe(false);
  });

  it("el caso real de Chapel Trail: con la subdivision deja de ser foreclosure de interes", () => {
    const base = {
      caption: "Chapel Trail Trade Center Inc         Plaintiff vs.   Bindra Investments Inc         Defendant",
      caseTypeCode: "Real Prop Comm Fore Between $50,000 and $250,000",
    };
    const sin = leerCasoForeclosure(JSON.stringify(base));
    expect(sin.demandanteEsConsorcio).toBe(false);
    expect(esForeclosureDeInteres(sin, "48")).toBe(true);
    const con = leerCasoForeclosure(JSON.stringify({ ...base, subdivision: "CHAPEL TRAIL TRADE CENTER" }));
    expect(con.demandanteEsConsorcio).toBe(true);
    expect(esForeclosureDeInteres(con, "48")).toBe(false);
  });

  it("un banco sobre una propiedad de esa subdivision sigue siendo de interes", () => {
    const caso = leerCasoForeclosure(JSON.stringify({
      caption: "CITY NATIONAL BANK OF FLORIDA Plaintiff vs. NARANG PLAZA POMPANO, INC. Defendant",
      caseTypeCode: "Real Prop Comm Fore $250,000 or More",
      subdivision: "NARANG PLAZA",
    }));
    expect(caso.demandanteEsConsorcio).toBe(false);
    expect(esForeclosureDeInteres(caso, "11")).toBe(true);
  });
});
