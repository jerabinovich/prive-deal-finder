import { subdivisionesBroward } from "./broward-parcelas";

afterEach(() => jest.restoreAllMocks());

function servicio(consulta: unknown) {
  const llamadas: string[] = [];
  jest.spyOn(global, "fetch").mockImplementation(async (entrada) => {
    const u = String(entrada);
    llamadas.push(u);
    const cuerpo = u.includes("/query?") ? consulta : { layers: [{ id: 16, name: "Parcels" }, { id: 14, name: "Subdiv. Name" }] };
    return { ok: true, json: async () => cuerpo } as Response;
  });
  return llamadas;
}

describe("subdivisionesBroward", () => {
  it("nombre de la subdivision por las primeras 8 posiciones del folio, de la capa Subdiv. Name y sin paginar", async () => {
    const llamadas = servicio({ features: [{ attributes: { SUB8: "513910AA", LEGAL_LINE: "CHAPEL TRAIL TRADE CENTER" } }] });
    const r = await subdivisionesBroward("https://s/Z/MapServer/36", ["513910AA0051", "513910AA0010", "999999990000"]);
    const consulta = llamadas.filter((u) => u.includes("/query?"));
    expect(consulta).toHaveLength(1);
    expect(consulta[0].startsWith("https://s/Z/MapServer/14/query?")).toBe(true);
    expect(decodeURIComponent(consulta[0])).toContain("SUB8 IN ('513910AA','99999999')");
    expect(consulta[0]).not.toContain("resultRecordCount");
    expect(r.get("513910AA0051")).toBe("CHAPEL TRAIL TRADE CENTER");
    expect(r.get("513910AA0010")).toBe("CHAPEL TRAIL TRADE CENTER");
    expect(r.has("999999990000")).toBe(false);
  });

  it("si la capa responde con error, los folios quedan sin nombre y no se cae", async () => {
    servicio({ error: { code: 400, message: "Pagination is not supported." } });
    const r = await subdivisionesBroward("https://t/Z/MapServer/36", ["513910AA0051"]);
    expect(r.size).toBe(0);
  });
});
