import { IntegrationStatus } from "./types";
import { BrowardForeclosureConnector, planBrowardDates } from "./broward-foreclosure.connector";

// 25-oct-2026: una sola consulta por dia habil, de la fecha que quedo 2 dias habiles atras; ninguna el fin de
// semana. Nada de esto llama al portal: fetch es simulado y cuenta las llamadas (cada una son 2 unidades).
const ENV = { ...process.env };
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const at = (iso: string) => new Date(`${iso}T08:00:00`); // 08:00 local, como el cron

let fetchMock: jest.Mock;
beforeEach(() => {
  process.env = { ...ENV, BROWARD_FORECLOSURE_API_KEY: "clave-de-prueba", BROWARD_FORECLOSURE_CASE_TYPES: "All",
                  BROWARD_FORECLOSURE_LOOKBACK_DAYS: "2", BROWARD_FORECLOSURE_MAX_REQUESTS: "30" };
  delete process.env.BROWARD_FORECLOSURE_LAG_BUSINESS_DAYS;
  fetchMock = jest.fn(async () => ({ ok: true, status: 200, text: async () => "[]" }));
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
});
afterEach(() => jest.useRealTimers());
afterAll(() => { process.env = ENV; });

const fechaPedida = (call: unknown[]) => new URL(String(call[0])).searchParams.get("date");

describe("planBrowardDates (D-2 habiles)", () => {
  it.each([
    ["2026-10-26", "2026-10-22"], // lunes -> jueves
    ["2026-10-27", "2026-10-23"], // martes -> viernes
    ["2026-10-28", "2026-10-26"], // miercoles -> lunes
    ["2026-10-29", "2026-10-27"], // jueves -> martes
    ["2026-10-30", "2026-10-28"], // viernes -> miercoles
  ])("%s consulta %s", (hoy, esperada) => {
    expect(planBrowardDates(at(hoy), 2).map(ymd)).toEqual([esperada]);
  });
  it.each(["2026-10-24", "2026-10-25"])("%s (fin de semana) no consulta", (hoy) => {
    expect(planBrowardDates(at(hoy), 2)).toEqual([]);
  });
  it("lunes a viernes cubren las 5 fechas habiles una sola vez", () => {
    const fechas = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]
      .flatMap((d) => planBrowardDates(at(d), 2).map(ymd));
    expect(new Set(fechas).size).toBe(5);
  });
});

describe("sync de Broward", () => {
  it("un lunes hace UNA llamada, por el jueves", async () => {
    jest.useFakeTimers().setSystemTime(at("2026-10-26"));
    const r = await new BrowardForeclosureConnector().sync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fechaPedida(fetchMock.mock.calls[0])).toBe("2026-10-22");
    expect(r.status).toBe(IntegrationStatus.OK);
  });
  it("un domingo no llama y termina en OK (no en fallo)", async () => {
    jest.useFakeTimers().setSystemTime(at("2026-10-25"));
    const r = await new BrowardForeclosureConnector().sync();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.status).toBe(IntegrationStatus.OK);
    expect(r.metrics).toMatchObject({ requestsMade: 0 });
  });
  it("LAG_BUSINESS_DAYS=0 vuelve al plan anterior (hoy primero)", async () => {
    process.env.BROWARD_FORECLOSURE_LAG_BUSINESS_DAYS = "0";
    jest.useFakeTimers().setSystemTime(at("2026-10-26"));
    await new BrowardForeclosureConnector().sync();
    expect(fechaPedida(fetchMock.mock.calls[0])).toBe("2026-10-26");
    expect(fetchMock.mock.calls.length).toBe(2);
  });
});
