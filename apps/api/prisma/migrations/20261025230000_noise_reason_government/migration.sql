-- 25-oct-2026 (JR: "las parcelas del gov no aplican en nuestra busqueda, no merecen analisis"): motivo de ruido
-- para los inmuebles de gobierno. Solo agrega un valor al enum; ninguna fila lo usa hasta el triage con el codigo nuevo.
ALTER TYPE "NoiseReason" ADD VALUE IF NOT EXISTS 'GOVERNMENT';
