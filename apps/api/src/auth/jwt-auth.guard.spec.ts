import { rutaHabilitadaParaServicio } from "./jwt-auth.guard";

describe("rutas de la cuenta de servicio (x-api-key)", () => {
  it("habilita los crons: sincronizar, estado, corridas, backfill y el triage de la alerta", () => {
    expect(rutaHabilitadaParaServicio("POST", "/api/integrations/broward-foreclosure/sync")).toBe(true);
    expect(rutaHabilitadaParaServicio("GET", "/api/integrations/status")).toBe(true);
    expect(rutaHabilitadaParaServicio("GET", "/api/integrations/runs?limit=5")).toBe(true);
    expect(rutaHabilitadaParaServicio("POST", "/api/deals/backfill-facts")).toBe(true);
    expect(rutaHabilitadaParaServicio("POST", "/api/deals/recompute-triage")).toBe(true);
    expect(rutaHabilitadaParaServicio("post", "/api/deals/recompute-triage/")).toBe(true);
    expect(rutaHabilitadaParaServicio("GET", "/api/deals/9aeabd1b-87ee-409b-a762-10a9108e5c31/recorded-debt")).toBe(true);
  });

  it("no abre el resto de la API", () => {
    expect(rutaHabilitadaParaServicio("GET", "/api/deals")).toBe(false);
    expect(rutaHabilitadaParaServicio("GET", "/api/deals/recompute-triage")).toBe(false);
    expect(rutaHabilitadaParaServicio("DELETE", "/api/deals/abc")).toBe(false);
    expect(rutaHabilitadaParaServicio("POST", "/api/auth/login")).toBe(false);
    expect(rutaHabilitadaParaServicio("POST", "/api/deals/recompute-triage/extra")).toBe(false);
    expect(rutaHabilitadaParaServicio("POST", "/api/deals/abc/recorded-debt")).toBe(false);
    expect(rutaHabilitadaParaServicio("GET", "/api/deals/abc/recorded-debt/otra")).toBe(false);
  });
});
