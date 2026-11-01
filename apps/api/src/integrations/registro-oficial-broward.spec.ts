import {
  agregarArchivo,
  anioDelInstrumento,
  escrituraDeLaHipoteca,
  evaluarCadenas,
  huellaDeClave,
  indiceVacio,
  leerDocumento,
  leerEnlace,
  leerParte,
  MAX_ANIOS_POR_CORRIDA,
  normalizarCaso,
  registroOficialActivo,
  resolverCadenas,
  type OrigenRegistro,
} from "./registro-oficial-broward";

// 31-oct-2026: el formato es el del FTP de Official Records de Broward (archivo del 29 oct y exportacion de 2012),
// con nombres inventados. La cadena real que reproduce: lis pendens 121179930 -> hipoteca 110618960 de 2012 ->
// escritura 110618959 -> folio 504206200430.
const doc = (inst: string, tipo: string, extra: Partial<Record<"fecha" | "hora" | "folio" | "caso" | "monto", string>> = {}) => {
  const fecha = extra.fecha ?? "20120316";
  const f = `${fecha.slice(4, 6)}/${fecha.slice(6, 8)}/${fecha.slice(0, 4)}`;
  return `${inst}|${fecha}|${f}|${extra.hora ?? "014917"}|${tipo}|${extra.monto ?? "0.00"}|48584|1647|O|LOTE DEMO|${extra.folio ?? ""}|700.00||2|0|V||E|${extra.caso ?? ""}|`;
};
const nme = (inst: string, nombre: string, lado: "D" | "R", orden = 1) => `${inst}|${nombre}|${lado}|${orden}|`;
const lnk = (inst: string, destino: string, tipo = "M") => `${inst}|||O|LP|${destino}|48584|1648|O|${tipo}|48584/1648|`;

function ventana(docs: string[], nombres: string[], enlaces: string[]) {
  const ind = indiceVacio();
  agregarArchivo(ind, "doc", docs.join("\r\n"));
  agregarArchivo(ind, "nme", nombres.join("\n"));
  agregarArchivo(ind, "lnk", enlaces.join("\n"));
  ind.dias = ["2026-10-29"];
  return ind;
}

const CASO = "CACE-26-099001";
const basicos = {
  docs: [
    doc("121179930", "LP", { fecha: "20261029", hora: "032006", caso: CASO }),
    doc("110618959", "D", { folio: "504206200430", monto: "100000.00" }),
    doc("110618960", "M", { monto: "97465.00" }),
  ],
  nombres: [
    nme("121179930", "BANCO DEMO NA", "D"),
    nme("121179930", "PEREZ,JUAN", "R", 1),
    nme("121179930", "SAINT PEREZ,JUAN", "R", 2),
    nme("110618959", "VENDEDOR DEMO TRUST", "D"),
    nme("110618959", "PEREZ,JUAN", "R"),
    nme("110618960", "SAINT PEREZ,JUAN", "D"),
    nme("110618960", "MORTGAGE ELECTRONIC REGISTRATION SYSTEMS INC", "R"),
  ],
  enlaces: [lnk("121179930", "110618960")],
};

describe("registro-oficial-broward: lectura del indice", () => {
  it("lee documento, parte y enlace con el formato real", () => {
    const d = leerDocumento(doc("110618959", "D", { folio: "504206200430" }).split("|"));
    expect(d).toMatchObject({ instrumento: "110618959", fecha: "20120316", hora: "014917", tipo: "D", folio: "504206200430" });
    const lp = leerDocumento(doc("121177988", "LP", { caso: "CONO-26-080180" }).split("|"));
    expect(lp?.caso).toBe("CONO-26-080180");
    expect(leerParte("121177988|ARAGON CONDOMINIUM ASSN INC|D|1|".split("|"))).toEqual({
      instrumento: "121177988",
      nombre: "ARAGON CONDOMINIUM ASSN INC",
      lado: "D",
    });
    expect(leerEnlace("121178592|||O|LP|110775507|48774|38|O|M|48774/38|".split("|"))).toMatchObject({
      destino: "110775507",
      tipoDestino: "M",
    });
    expect(leerEnlace("121177902|||O|RST||||||-NOT SHOWN|".split("|"))).toBeNull();
    expect(leerDocumento("encabezado|sin|numero".split("|"))).toBeNull();
  });
  it("una linea con la marca de orden de bytes leida en latin1, y con fin de linea de Windows, entra igual", () => {
    const ind = indiceVacio();
    agregarArchivo(ind, "doc", "\u00EF\u00BB\u00BF" + doc("110618959", "D", { folio: "504206200430" }) + "\r\n");
    expect(ind.docs.get("110618959")?.folio).toBe("504206200430");
  });
  it("el caso del Clerk y el del indice se comparan sin guiones", () => {
    expect(normalizarCaso("CACE-26-017727")).toBe(normalizarCaso("CACE26017727"));
  });
});

describe("registro-oficial-broward: la cadena", () => {
  it("lis pendens -> hipoteca -> escritura con folio, con el deudor entre los demandados", () => {
    const ind = ventana(basicos.docs, basicos.nombres, basicos.enlaces);
    const { resultados } = evaluarCadenas([{ caso: "CACE26099001" }], ind);
    const r = resultados.get("CACE26099001");
    expect(r?.estado).toBe("CADENA");
    expect(r?.folios).toEqual(["504206200430"]);
    expect(r?.motivo).toContain("hipoteca 110618960");
    expect(r?.motivo).toContain("escritura 110618959");
  });
  it("sin lis pendens del caso en la ventana", () => {
    const { resultados } = evaluarCadenas([{ caso: "CACE26000001" }], ventana(basicos.docs, basicos.nombres, basicos.enlaces));
    expect(resultados.get("CACE26000001")?.estado).toBe("SIN_LIS_PENDENS");
  });
  it("lis pendens de un consorcio, sin hipoteca enlazada", () => {
    const ind = ventana(basicos.docs, basicos.nombres, []);
    expect(evaluarCadenas([{ caso: CASO }], ind).resultados.get("CACE26099001")?.estado).toBe("SIN_HIPOTECA_ENLAZADA");
  });
  it("un enlace a algo que no es hipoteca (gravamen de construccion) no cuenta", () => {
    const ind = ventana(basicos.docs, basicos.nombres, [lnk("121179930", "110618960", "NOC")]);
    expect(evaluarCadenas([{ caso: CASO }], ind).resultados.get("CACE26099001")?.estado).toBe("SIN_HIPOTECA_ENLAZADA");
  });
  it("el deudor de la hipoteca tiene que ser un demandado", () => {
    const nombres = basicos.nombres.map((l) => l.replace("110618960|SAINT PEREZ,JUAN", "110618960|GOMEZ,ANA"));
    const ind = ventana(basicos.docs, nombres, basicos.enlaces);
    expect(evaluarCadenas([{ caso: CASO }], ind).resultados.get("CACE26099001")?.estado).toBe("DEUDOR_NO_COINCIDE");
  });
  it("el demandado del expediente del Clerk tambien vale, escrito como en la caratula", () => {
    const nombres = basicos.nombres.filter((l) => !l.startsWith("121179930|")).map((l) => l.replace("SAINT PEREZ,JUAN", "GOMEZ,ANA"));
    const ind = ventana(basicos.docs, nombres, basicos.enlaces);
    expect(evaluarCadenas([{ caso: CASO, demandado: "Ana Gomez" }], ind).resultados.get("CACE26099001")?.estado).toBe("CADENA");
  });
  it("una empresa deudora se compara por el nucleo del nombre", () => {
    const nombres = [
      nme("121179930", "DEMO CAPITAL VENTURES LLC", "R"),
      nme("110618960", "DEMO CAPITAL VENTURES L.L.C.", "D"),
    ];
    const ind = ventana(basicos.docs, nombres, basicos.enlaces);
    expect(evaluarCadenas([{ caso: CASO }], ind).resultados.get("CACE26099001")?.estado).toBe("CADENA");
  });
  it("hipoteca de un refinanciamiento: sin escritura al lado, no resuelve", () => {
    const docs = [basicos.docs[0], doc("110618959", "NOC"), basicos.docs[2]];
    const ind = ventana(docs, basicos.nombres, basicos.enlaces);
    expect(evaluarCadenas([{ caso: CASO }], ind).resultados.get("CACE26099001")?.estado).toBe("SIN_ESCRITURA");
  });
  it("otra hipoteca en el medio es otro cierre: corta", () => {
    const docs = [basicos.docs[0], doc("110618958", "D", { folio: "504206200430" }), doc("110618959", "M"), basicos.docs[2]];
    const ind = ventana(docs, basicos.nombres, basicos.enlaces);
    expect(evaluarCadenas([{ caso: CASO }], ind).resultados.get("CACE26099001")?.estado).toBe("SIN_ESCRITURA");
  });
  it("una escritura de otro dia o de otra tanda no es la del cierre", () => {
    for (const extra of [{ fecha: "20120315" }, { hora: "015500" }]) {
      const docs = [basicos.docs[0], doc("110618959", "D", { folio: "504206200430", ...extra }), basicos.docs[2]];
      const ind = ventana(docs, basicos.nombres, basicos.enlaces);
      expect(evaluarCadenas([{ caso: CASO }], ind).resultados.get("CACE26099001")?.estado).toBe("SIN_ESCRITURA");
    }
  });
  it("la hora va en 12 horas: 12:59:30 y 01:00:10 son la misma tanda", () => {
    const docs = new Map([
      ["110618959", leerDocumento(doc("110618959", "D", { folio: "504206200430", hora: "125930" }).split("|"))!],
    ]);
    const hip = leerDocumento(doc("110618960", "M", { hora: "010010" }).split("|"))!;
    expect(escrituraDeLaHipoteca(hip, docs)?.folio).toBe("504206200430");
  });
  it("un folio con forma rara no se usa", () => {
    const docs = [basicos.docs[0], doc("110618959", "D", { folio: "50420620'0430" }), basicos.docs[2]];
    const ind = ventana(docs, basicos.nombres, basicos.enlaces);
    expect(evaluarCadenas([{ caso: CASO }], ind).resultados.get("CACE26099001")?.estado).toBe("SIN_ESCRITURA");
  });
  it("la hipoteca que no esta en la ventana queda para buscar en la exportacion anual", () => {
    const ind = ventana([basicos.docs[0]], basicos.nombres.filter((l) => l.startsWith("121179930|")), basicos.enlaces);
    const { resultados, hipotecasFaltantes } = evaluarCadenas([{ caso: CASO }], ind);
    expect(resultados.get("CACE26099001")?.estado).toBe("HIPOTECA_NO_ENCONTRADA");
    expect([...hipotecasFaltantes]).toEqual(["110618960"]);
  });
});

describe("registro-oficial-broward: exportaciones anuales", () => {
  it("el anio de un instrumento sale del primer instrumento de cada exportacion", () => {
    const rangos = [
      { anio: "1999", desde: 99000001 },
      { anio: "2011", desde: 109787091 },
      { anio: "2012", desde: 110469335 },
      { anio: "2013", desde: 111221281 },
    ];
    expect(anioDelInstrumento("110618960", rangos)).toBe("2012");
    expect(anioDelInstrumento("99000005", rangos)).toBe("1999");
    expect(anioDelInstrumento("1", rangos)).toBeNull();
  });

  function origenFalso(archivos: Record<string, string>): OrigenRegistro & { recorridos: string[] } {
    const recorridos: string[] = [];
    return {
      recorridos,
      listar: async (dir) => Object.keys(archivos).filter((k) => k.startsWith(`${dir}/`)).map((k) => k.slice(dir.length + 1)),
      leer: async (ruta) => archivos[ruta] ?? "",
      leerInicio: async (ruta, bytes) => (archivos[ruta] ?? "").slice(0, bytes),
      recorrer: async (ruta, porLinea) => {
        recorridos.push(ruta);
        for (const l of (archivos[ruta] ?? "").split("\n")) porLinea(l);
      },
      cerrar: async () => undefined,
    };
  }

  it("busca la hipoteca de 2012 en su exportacion y resuelve", async () => {
    const origen = origenFalso({
      "Official_Records_Download/10-29-2026doc-ver.txt": basicos.docs[0],
      "Official_Records_Download/10-29-2026nme-ver.txt": basicos.nombres.filter((l) => l.startsWith("121179930|")).join("\n"),
      "Official_Records_Download/10-29-2026lnk-ver.txt": basicos.enlaces.join("\n"),
      "Official_Records_Download/10-29-2026img.zip": "no se lee",
      "OR_Yearly_Exports/CY2011doc-rec.txt": "\u00EF\u00BB\u00BF" + doc("109787091", "D"),
      "OR_Yearly_Exports/CY2011nme-rec.txt": "",
      "OR_Yearly_Exports/CY2012doc-rec.txt": [doc("110469335", "D"), basicos.docs[1], basicos.docs[2]].join("\r\n"),
      "OR_Yearly_Exports/CY2012nme-rec.txt": basicos.nombres.filter((l) => !l.startsWith("121179930|")).join("\r\n"),
    });
    const r = (await resolverCadenas([{ caso: "CACE26099001" }], origen)).get("CACE26099001");
    expect(r?.estado).toBe("CADENA");
    expect(r?.folios).toEqual(["504206200430"]);
    expect(origen.recorridos).toEqual(["OR_Yearly_Exports/CY2012doc-rec.txt", "OR_Yearly_Exports/CY2012nme-rec.txt"]);
  });

  it("recorre como mucho MAX_ANIOS_POR_CORRIDA anios, los mas recientes primero", async () => {
    const archivos: Record<string, string> = {};
    const docs: string[] = [];
    const nombres: string[] = [];
    const enlaces: string[] = [];
    for (let i = 0; i < MAX_ANIOS_POR_CORRIDA + 2; i += 1) {
      const anio = 2010 + i;
      const base = 100000000 + i * 1000000;
      archivos[`OR_Yearly_Exports/CY${anio}doc-rec.txt`] = doc(String(base), "D");
      archivos[`OR_Yearly_Exports/CY${anio}nme-rec.txt`] = "";
      const lp = String(121100000 + i);
      docs.push(doc(lp, "LP", { fecha: "20261029", caso: `CACE-26-0990${10 + i}` }));
      nombres.push(nme(lp, "PEREZ,JUAN", "R"));
      enlaces.push(lnk(lp, String(base + 50)));
    }
    archivos["Official_Records_Download/10-29-2026doc-ver.txt"] = docs.join("\n");
    archivos["Official_Records_Download/10-29-2026nme-ver.txt"] = nombres.join("\n");
    archivos["Official_Records_Download/10-29-2026lnk-ver.txt"] = enlaces.join("\n");
    const origen = origenFalso(archivos);
    await resolverCadenas(docs.map((_, i) => ({ caso: `CACE260990${10 + i}` })), origen);
    const anios = origen.recorridos.filter((r) => r.endsWith("doc-rec.txt")).map((r) => r.slice(-15, -11));
    expect(anios.length).toBe(MAX_ANIOS_POR_CORRIDA);
    expect(anios[0]).toBe(String(2010 + MAX_ANIOS_POR_CORRIDA + 1));
  });
});

describe("registro-oficial-broward: interruptor y huella", () => {
  it("BROWARD_REGISTRO_OFICIAL=off lo apaga; sin la variable queda prendido", () => {
    expect(registroOficialActivo({})).toBe(true);
    expect(registroOficialActivo({ BROWARD_REGISTRO_OFICIAL: "OFF" })).toBe(false);
    expect(registroOficialActivo({ BROWARD_REGISTRO_OFICIAL: "on" })).toBe(true);
  });
  it("la huella es la de OpenSSH: SHA256 en base64 sin relleno", () => {
    expect(huellaDeClave(Buffer.from("abc"))).toBe("ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0");
  });
});
