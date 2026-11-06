/**
 * Archiva la ventana diaria del registro oficial de Broward (src/integrations/registro-diario-broward.ts).
 * Repetible sin efecto: solo baja los archivos de indice que faltan. Gratis (FTP publico del condado, huella fijada).
 *
 * Uso, desde apps/api, despues del build:
 *   node scripts/registro-diario.js            baja lo que falta a ~/broward-or/diario (o BROWARD_REGISTRO_DIARIO_DIR)
 */
const { abrirOrigenBroward } = require("../dist/integrations/registro-oficial-broward");
const { archivarVentana, dirRegistroDiario } = require("../dist/integrations/registro-diario-broward");

async function main() {
  const dir = dirRegistroDiario();
  const origen = await abrirOrigenBroward();
  try {
    const r = await archivarVentana(origen, dir);
    console.log(new Date().toISOString(), "registro diario", JSON.stringify({ dir, enFtp: r.enFtp, bajados: r.bajados.length, yaEstaban: r.yaEstaban, dias: r.dias }));
  } finally {
    await origen.cerrar();
  }
}

main().catch((e) => {
  console.error(new Date().toISOString(), "error:", e && e.message ? e.message : e);
  process.exit(1);
});
