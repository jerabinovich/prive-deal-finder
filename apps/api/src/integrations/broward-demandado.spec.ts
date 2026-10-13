import {
  analizarDemandado,
  codigoMunicipioDemandante,
  coincideDueno,
  demandanteDeCaratula,
  elegirParcelas,
  prefijosDeBusqueda,
  resolverDemandadoBroward,
  TOPE_CANDIDATAS,
  type Candidata,
  type Demandado,
} from "./broward-demandado";
import { ciudadBroward, codigoCiudadBroward } from "./ciudades-broward";
import { fetchArcgisWhere } from "./connectors/arcgis";

jest.mock("./connectors/arcgis", () => ({ fetchArcgisWhere: jest.fn() }));
const fetchMock = fetchArcgisWhere as jest.MockedFunction<typeof fetchArcgisWhere>;

const dem = (crudo: string) => analizarDemandado(crudo) as Demandado;
const c = (folio: string, dueno: string, uso: string, ciudad: string, homestead = false): Candidata => ({
  folio, dueno, uso, ciudad, homestead,
});
const feature = (x: Candidata) => ({
  attributes: {
    FOLIO_NUMBER: x.folio, NAME_LINE_1: x.dueno, USE_CODE: x.uso, SITUS_CITY: x.ciudad,
    SOH_YEAR: x.homestead ? "08" : "--",
  },
});
const comercial = { clase: "COMERCIAL" as const };
const homestead = { clase: "RES_HOMESTEAD" as const };
const otro = { clase: "OTRO" as const };

// Respuestas reales del catastro del 13-oct.
const ANDREWS_PARKLAND = c("474129040300", "ANDREWS,EVA & JAMES R", "01", "PA");
const RETAIL_1 = c("494227000171", "ANDREWS AVE RETAIL LLC", "11", "WM");
const RETAIL_2 = c("494227000180", "ANDREWS AVE RETAIL LLC", "11", "WM");

describe("analizarDemandado", () => {
  it("sociedad: nucleo sin sufijo legal y prefijo de dos palabras", () => {
    expect(dem("ANDREWS AVE RETAIL LLC")).toEqual({
      tipo: "EMPRESA", nucleo: "ANDREWS AVE RETAIL", sufijo: "LLC", prefijo: "ANDREWS AVE",
    });
  });

  it("corta lo que Broward agrega despues del sufijo", () => {
    expect(dem("Rtop 1017 Llc A Florida Limited Liability Company")).toMatchObject({ nucleo: "RTOP 1017", sufijo: "LLC" });
    expect(dem("Sandlewood Properties Trust Llc A Florida Limited")).toMatchObject({
      nucleo: "SANDLEWOOD PROPERTIES", sufijo: "TRUST",
    });
  });

  it("el prefijo busca el & del catastro, lleva el apostrofo como comodin y no entra en palabras abreviables", () => {
    expect(dem("V & R Family Enterprises Corp")).toMatchObject({ nucleo: "V AND R FAMILY ENTERPRISES", prefijo: "V & R" });
    expect(dem("JP and P INVESTMENTS LLC")).toMatchObject({ prefijo: "JP & P" });
    expect(dem("AMERICA'S HOME AND BUILDERS, LLC")).toMatchObject({ prefijo: "AMERICA_S HOME" });
    expect(dem("ETON COUNTRYSIDE CONDOMINIUM ASSOCIATION INC")).toMatchObject({
      nucleo: "ETON COUNTRYSIDE CONDO ASSN", prefijo: "ETON COUNTRYSIDE",
    });
  });

  it("persona: nombre, medios y apellido; ignora JR y deja el compuesto como alternativa", () => {
    expect(dem("Kevin R. Turner")).toEqual({
      tipo: "PERSONA", nombre: "KEVIN", medios: ["R"], apellido: "TURNER", apellidoCompuesto: null,
    });
    expect(dem("David Johnson Jr")).toMatchObject({ nombre: "DAVID", apellido: "JOHNSON", medios: [] });
    expect(prefijosDeBusqueda(dem("Rodolfo Muniz rivero"))).toEqual(["RIVERO,RODOLFO", "MUNIZ RIVERO,RODOLFO"]);
  });

  it("sin nombre util no hay busqueda", () => {
    expect(analizarDemandado("")).toBeNull();
    expect(analizarDemandado("Smith")).toBeNull();
  });
});

describe("coincideDueno", () => {
  it("sociedad: mismo nucleo y sufijo compatible, nada de primera palabra", () => {
    const d = dem("ANDREWS AVE RETAIL LLC");
    expect(coincideDueno(d, "ANDREWS,EVA & JAMES R")).toBe(false);
    expect(coincideDueno(d, "ANDREWS AVE RETAIL LLC")).toBe(true);
    expect(coincideDueno(d, "ANDREWS AVE RETAIL, L.L.C.")).toBe(true);
    expect(coincideDueno(d, "ANDREWS AVE RETAIL HOLDINGS LLC")).toBe(false);
    expect(coincideDueno(d, "ANDREWS AVE RETAIL INC")).toBe(false);
    expect(coincideDueno(dem("ETON COUNTRYSIDE CONDOMINIUM ASSOCIATION INC"), "ETON COUNTRYSIDE CONDO ASSN INC")).toBe(true);
  });

  it("persona: apellido y nombre exactos, segundo nombre compatible con cualquiera de los del medio", () => {
    const d = dem("Kevin R. Turner");
    expect(coincideDueno(d, "TURNER,KEVIN R & MARY")).toBe(true);
    expect(coincideDueno(d, "TURNER,KEVIN EST")).toBe(true);
    expect(coincideDueno(d, "TURNER,KEVIN ALTON")).toBe(false);
    expect(coincideDueno(d, "TURNER,KEVINA")).toBe(false);
    expect(coincideDueno(dem("Dean Thompson"), "THOMPSON,DEANDRE CORNELIUS")).toBe(false);
    expect(coincideDueno(dem("David Johnson Jr"), "JOHNSON,DAVID JR & TUYET")).toBe(true);
    expect(coincideDueno(dem("Kevin George cray Walters"), "WALTERS,KEVIN C")).toBe(true);
    expect(coincideDueno(dem("Marie Solange Benoit"), "BENOIT,MARIE H/E")).toBe(true);
    expect(coincideDueno(dem("Marie Solange Benoit"), "BENOIT,MARIE SONIE")).toBe(false);
  });

  it("persona con apellido compuesto", () => {
    const d = dem("Rodolfo Muniz rivero");
    expect(coincideDueno(d, "MUNIZ RIVERO,RODOLFO")).toBe(true);
    expect(coincideDueno(d, "RIVERO,RODOLFO M")).toBe(true);
    expect(coincideDueno(d, "RIVERO,RODOLFO A")).toBe(false);
  });
});

describe("elegirParcelas", () => {
  it("el caso real de Wilton Manors: los dos locales del demandado, no la casa de Parkland", () => {
    const r = elegirParcelas(dem("ANDREWS AVE RETAIL LLC"), comercial, [ANDREWS_PARKLAND, RETAIL_1, RETAIL_2], false);
    expect(r.estado).toBe("MISMO_DUENO");
    expect(r.folios).toEqual(["494227000171", "494227000180"]);
  });

  it("homonimos con homestead propio cada uno: no se adivina", () => {
    const candidatas = [
      c("494024050890", "MARTINEZ,ERNESTO", "01", "SU", true),
      c("494222092603", "MARTINEZ,ERNESTO", "01", "OP", true),
      c("514009050090", "MARTINEZ,ERNESTO & MARCIE", "01", "PI", true),
    ];
    expect(elegirParcelas(dem("Ernesto Martinez"), homestead, candidatas, false)).toMatchObject({ estado: "AMBIGUA", folios: [] });
  });

  it("caso homestead: la parcela con homestead del demandado (Elderkin, real)", () => {
    const candidatas = [
      c("494212AK2600", "ELDERKIN,KARL O", "04", "FL", false),
      c("494306130420", "ELDERKIN,KARL O", "01", "PB", true),
    ];
    expect(elegirParcelas(dem("Karl O. Elderkin"), homestead, candidatas, false)).toMatchObject({
      estado: "UNICA", folios: ["494306130420"],
    });
  });

  it("con segundo nombre en el expediente, gana el folio que lo tiene", () => {
    const candidatas = [c("1", "YOUNG,SHIRLEY D", "01", "FL", true), c("2", "YOUNG,SHIRLEY H/E", "01", "MG", true)];
    expect(elegirParcelas(dem("Shirley Diane Young"), homestead, candidatas, false)).toMatchObject({
      estado: "UNICA", folios: ["1"],
    });
    const benoit = [
      c("494103042570", "BENOIT,MARIE H/E", "01", "TM", true),
      c("494111BA0640", "BENOIT,MARIE SOLANGE", "04", "TM", true),
      c("514030100510", "BENOIT,MARIE SONIE", "01", "MM", true),
    ];
    expect(elegirParcelas(dem("Marie Solange Benoit"), homestead, benoit, false)).toMatchObject({
      estado: "UNICA", folios: ["494111BA0640"],
    });
  });

  it("caso non homestead: la parcela sin homestead", () => {
    const candidatas = [c("1", "MATOS,ELSA", "04", "SU", true), c("2", "MATOS,ELSA H/E", "08", "BC", false)];
    expect(elegirParcelas(dem("Elsa Matos"), { clase: "RES_NO_HOMESTEAD" }, candidatas, false)).toMatchObject({
      estado: "UNICA", folios: ["2"],
    });
  });

  it("si ninguna tiene homestead, el filtro no vacia: decide el resto", () => {
    const candidatas = [c("484130040470", "TURNER,KEVIN EST", "01", "CS", false), c("9", "TURNER,KEVIN ALTON", "01", "PI", true)];
    expect(elegirParcelas(dem("Kevin R. Turner"), homestead, candidatas, false)).toMatchObject({
      estado: "UNICA", folios: ["484130040470"],
    });
  });

  it("caso residencial: descarta las parcelas no residenciales del mismo dueño", () => {
    const candidatas = [c("1", "LAINGOR,VERONICA", "04", "DB"), c("2", "LAINGOR,VERONICA", "11", "DB")];
    expect(elegirParcelas(dem("Veronica Laingor"), { clase: "RES_NO_HOMESTEAD" }, candidatas, false)).toMatchObject({
      estado: "UNICA", folios: ["1"],
    });
  });

  it("demandante municipal: la parcela dentro de ese municipio (New Global Holdings, real)", () => {
    const candidatas = ["PB", "PB", "WM", "FL", "DN", "HW"].map((ciudad, i) => c(String(i), "NEW GLOBAL HOLDINGS INC", "11", ciudad));
    const ctx = { clase: "COMERCIAL" as const, demandante: "CITY OF WILTON MANORS" };
    expect(elegirParcelas(dem("NEW GLOBAL HOLDINGS INC"), ctx, candidatas, false)).toMatchObject({ estado: "UNICA", folios: ["2"] });
    expect(elegirParcelas(dem("NEW GLOBAL HOLDINGS INC"), comercial, candidatas, false).estado).toBe("AMBIGUA");
  });

  it("sociedad con muchas parcelas o en varias ciudades: ambigua", () => {
    const d = dem("JAX MIAMI LLC");
    const cuatro = ["1", "2", "3", "4"].map((f) => c(f, "JAX MIAMI LLC", "01", "PA"));
    expect(elegirParcelas(d, otro, cuatro, false).estado).toBe("AMBIGUA");
    const dosCiudades = [c("1", "JAX MIAMI LLC", "01", "PA"), c("2", "JAX MIAMI LLC", "01", "FL")];
    expect(elegirParcelas(d, otro, dosCiudades, false).estado).toBe("AMBIGUA");
  });

  it("si el catastro llego al tope no se elige, y sin coincidencia tampoco", () => {
    expect(elegirParcelas(dem("JAX MIAMI LLC"), otro, [c("1", "JAX MIAMI LLC", "01", "PA")], true).estado).toBe("AMBIGUA");
    expect(elegirParcelas(dem("JAX MIAMI LLC"), otro, [ANDREWS_PARKLAND], false)).toMatchObject({
      estado: "SIN_COINCIDENCIA", folios: [],
    });
  });
});

describe("municipios de Broward", () => {
  it("codigo y nombre, medidos contra City Limits", () => {
    expect(ciudadBroward("WM")).toBe("Wilton Manors");
    expect(ciudadBroward("BC")).toBe("Unincorporated Broward");
    expect(ciudadBroward("ZZ")).toBeNull();
    expect(codigoCiudadBroward("City of Fort Lauderdale")).toBe("FL");
    expect(codigoMunicipioDemandante("TOWN OF DAVIE, a Florida Municipal Corporation")).toBe("DV");
    expect(codigoMunicipioDemandante("CITY OF WILTON MANORS")).toBe("WM");
    expect(codigoMunicipioDemandante("U S BANK NATIONAL ASSOCIATION")).toBeNull();
    expect(demandanteDeCaratula("CITY OF WILTON MANORS         Plaintiff vs.   ANDREWS AVE RETAIL LLC")).toBe("CITY OF WILTON MANORS");
  });
});

describe("resolverDemandadoBroward", () => {
  beforeEach(() => fetchMock.mockReset());

  it("consulta por el prefijo, ordenando por folio, y devuelve solo los features elegidos", async () => {
    fetchMock.mockResolvedValueOnce([feature(RETAIL_1), feature(RETAIL_2)]);
    const r = await resolverDemandadoBroward("https://capa", "ANDREWS AVE RETAIL LLC", comercial);
    expect(fetchMock).toHaveBeenCalledWith("https://capa", "NAME_LINE_1 LIKE 'ANDREWS AVE%'", TOPE_CANDIDATAS, "FOLIO_NUMBER");
    expect(r.resolucion.estado).toBe("MISMO_DUENO");
    expect(r.features).toHaveLength(2);
  });

  it("persona con apellido compuesto: si la ultima palabra no encuentra, prueba las dos ultimas", async () => {
    fetchMock.mockResolvedValueOnce([]).mockResolvedValueOnce([feature(c("9", "MUNIZ RIVERO,RODOLFO", "04", "TM", true))]);
    const r = await resolverDemandadoBroward("https://capa", "Rodolfo Muniz rivero", homestead);
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://capa", "NAME_LINE_1 LIKE 'MUNIZ RIVERO,RODOLFO%'", TOPE_CANDIDATAS, "FOLIO_NUMBER");
    expect(r.resolucion).toMatchObject({ estado: "UNICA", folios: ["9"] });
  });

  it("sin nombre util no consulta", async () => {
    const r = await resolverDemandadoBroward("https://capa", "Smith", otro);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.resolucion.estado).toBe("SIN_NOMBRE");
  });
});
