import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { isGovP3DorCode, toDorCode } from "./dor-use-codes";
import {
  USOS_BUY_BOX_PB,
  ZCTA_33401,
  corredoresPalmBeach,
  dentroDe,
  dentroDelCorredor,
  normalizarRegistroPalmBeach,
  sinRepetidas,
  wherePalmBeach,
} from "./parcelas-palm-beach";

function buybox(contenido: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "buybox-pb-"));
  const ruta = join(dir, "buybox.json");
  writeFileSync(ruta, JSON.stringify(contenido));
  return ruta;
}

// Los corredores de Palm Beach como estan en buybox.json el 14 oct, mas uno de Miami que no aplica.
const CORREDORES = {
  _nota: "texto",
  Brickell: { zips: ["33131"], municipios: ["Miami"] },
  "Palm Beach": { zips: ["33480"], municipios: ["Palm Beach"] },
  "West Palm Beach (Downtown / Flagler)": { zips: ["33401"], municipios: ["West Palm Beach"] },
  "Boca Raton": { zips: ["33431", "33432", "33433", "33434", "33486", "33487", "33496"], municipios: ["Boca Raton"] },
  Manalapan: { zips: ["33462"], municipios: ["Manalapan"] },
  "Gulf Stream": { zips: ["33483"], municipios: ["Gulf Stream"] },
  "Jupiter / Jupiter Island": { zips: ["33458", "33469", "33477", "33455"], municipios: ["Jupiter", "Jupiter Island"] },
};

const parcela = (pcn: string, punto?: [number, number], parid = pcn) => ({
  attributes: { PARID: parid, PARCEL_NUMBER: pcn },
  ...(punto ? { geometry: { rings: [[[punto[0] - 0.0001, punto[1]], [punto[0] + 0.0001, punto[1]], [punto[0], punto[1] + 0.0001]]] } } : {}),
});

describe("Palm Beach por corredores", () => {
  it("municipios por codigo del PCN, West Palm Beach por secciones, Jupiter Island (Martin) afuera sin aviso", () => {
    const c = corredoresPalmBeach(buybox({ corredores_tier1: CORREDORES }));
    expect(c.prefijos.filter((p) => p.length === 2)).toEqual(["06", "20", "30", "42", "50"]);
    expect(c.prefijos.filter((p) => p.startsWith("744343"))).toHaveLength(14);
    expect(c.prefijos).not.toContain("74");
    expect(c.parciales).toHaveLength(1);
    expect(c.sinSoporte).toEqual([]);
  });

  it("no adivina: un municipio sin codigo medido o un corredor parcial con otros zips quedan en sinSoporte", () => {
    const c = corredoresPalmBeach(
      buybox({
        corredores_tier1: {
          "Palm Beach": { zips: ["33480"], municipios: ["Palm Beach"] },
          Delray: { zips: ["33483"], municipios: ["Delray Beach"] },
          "WPB entera": { zips: ["33401", "33405"], municipios: ["West Palm Beach"] },
          "Sin municipio": { zips: ["33480"] },
        },
      }),
    );
    expect(c.prefijos).toEqual(["50"]);
    expect(c.sinSoporte).toEqual(["Delray: DELRAY BEACH", "Sin municipio: sin municipios", "WPB entera: WEST PALM BEACH con zips 33401,33405"]);
  });

  it("sin corredores de Palm Beach falla con el motivo", () => {
    expect(() => corredoresPalmBeach(buybox({ corredores_tier1: { Brickell: { zips: ["33131"], municipios: ["Miami"] } } }))).toThrow(
      /sin corredores de Palm Beach/,
    );
  });

  it("la consulta: prefijos del PCN y usos del buy box, estable aunque cambie el orden de los corredores", () => {
    const w = wherePalmBeach(corredoresPalmBeach(buybox({ corredores_tier1: CORREDORES })));
    expect(w).toContain("PARCEL_NUMBER LIKE '06%'");
    expect(w).toContain("PARCEL_NUMBER LIKE '74434321%'");
    expect(w).toContain("'STORES'");
    expect(w).toContain("'MULTIFAMILY > 10 units Income Restricted'");
    for (const fuera of ["'SINGLE FAMILY'", "'CONDOMINIUM'", "'TOWNHOUSE'", "'AIRPORT/MARINA CONDO'", "'HOTEL CONDO'", "'HOTEL TIMESHARE'"]) {
      expect(w).not.toContain(fuera);
    }
    const alReves = Object.fromEntries(Object.entries(CORREDORES).reverse());
    expect(wherePalmBeach(corredoresPalmBeach(buybox({ corredores_tier1: alReves })))).toBe(w);
  });

  it("cada uso pedido tiene su codigo DOR del buy box, sin repetidos; la tierra publica va al carril P3", () => {
    const buyBox = (d: string) => ["00", "03", "08", "80", "86", "87", "88", "89"].includes(d) || (d >= "10" && d <= "49");
    for (const uso of USOS_BUY_BOX_PB) expect([uso, buyBox(toDorCode(uso) ?? "sin codigo")]).toEqual([uso, true]);
    expect(new Set(USOS_BUY_BOX_PB).size).toBe(USOS_BUY_BOX_PB.length);
    expect(toDorCode("Bowling / skating rink")).toBe("34");
    for (const gob of ["MUNICIPAL", "STATE", "FEDERAL", "DISTRICTS", "CITY INC NONMUNI"]) expect(isGovP3DorCode(gob)).toBe(true);
    expect(toDorCode("SINGLE FAMILY")).toBe("01");
  });

  it("West Palm Beach: solo las parcelas con el centro en la ZCTA 33401; las demas ciudades pasan enteras", () => {
    const c = corredoresPalmBeach(buybox({ corredores_tier1: CORREDORES }));
    expect(dentroDe([-80.0535, 26.7135], ZCTA_33401)).toBe(true); // Clematis St
    expect(dentroDe([-80.072, 26.694], ZCTA_33401)).toBe(true); // el enclave del sudoeste
    expect(dentroDe([-80.06, 26.68], ZCTA_33401)).toBe(false); // 33405
    expect(dentroDelCorredor(parcela("74434321250006140", [-80.0535, 26.7135]), c)).toBe(true);
    expect(dentroDelCorredor(parcela("74434309000001000", [-80.06, 26.755]), c)).toBe(false);
    expect(dentroDelCorredor(parcela("74434321250006140"), c)).toBe(false); // sin geometria no se ubica
    expect(dentroDelCorredor(parcela("06434631310052010"), c)).toBe(true);
  });

  it("el folio es el PCN de 17 digitos: en un condominio PARID es el del edificio", () => {
    const unidad = normalizarRegistroPalmBeach(parcela("06434717230002441", undefined, "0643471723")) as { attributes: Record<string, unknown> };
    expect(unidad.attributes.PARID).toBe("06434717230002441");
    const casa = { attributes: { PARID: "50434310030000231", PARCEL_NUMBER: "50434310030000231", MUNICIPALITY: "PALM BEACH", OTRO: 1 } };
    expect(normalizarRegistroPalmBeach(casa)).toEqual(casa);
    const sinPcn = { attributes: { PARID: "123" } };
    expect(normalizarRegistroPalmBeach(sinPcn)).toBe(sinPcn);
  });

  it("sin MUNICIPALITY en la capa, el municipio sale del codigo del PCN; si viene, se respeta", () => {
    const golf = normalizarRegistroPalmBeach({ attributes: { PARCEL_NUMBER: "06424702360070010", MUNICIPALITY: null } }) as {
      attributes: Record<string, unknown>;
    };
    expect(golf.attributes.MUNICIPALITY).toBe("BOCA RATON");
    const conCiudad = normalizarRegistroPalmBeach({ attributes: { PARCEL_NUMBER: "50434310030000231", MUNICIPALITY: "PALM BEACH" } }) as {
      attributes: Record<string, unknown>;
    };
    expect(conCiudad.attributes.MUNICIPALITY).toBe("PALM BEACH");
  });

  it("una fila por parcela, en el orden en que vinieron", () => {
    const f = (pcn: string, n: number) => ({ attributes: { PARCEL_NUMBER: pcn, N: n } });
    expect(sinRepetidas([f("1", 1), f("1", 2), f("2", 3), f("1", 4)])).toEqual([f("1", 1), f("2", 3)]);
  });
});
