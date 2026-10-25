import { LIBRERIA_CATASTRO } from "./catastro-valores";

// 25-oct-2026: contratos con prive-deal-finder-ops. scripts/alerta/alerta.py lee MdpaDatasetSnapshot.library y rotula
// "tasacion del catastro" cuando vale "fdor-catastro". Si este nombre cambia aca, la alerta pasa a rotular mal sin que
// ningun test de ops lo note: cambiar los dos repos juntos.
describe("contratos con prive-deal-finder-ops", () => {
  it("la libreria de las tasaciones del catastro estatal se llama fdor-catastro", () => {
    expect(LIBRERIA_CATASTRO).toBe("fdor-catastro");
  });
});
