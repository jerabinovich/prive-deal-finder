-- 16-oct-2026 (JR, "Quita P3"): motivo de ruido para la tierra de conservacion (refugios de fauna, conservancies).
-- Solo agrega un valor al enum; ninguna fila lo usa hasta el triage con el codigo nuevo.
ALTER TYPE "NoiseReason" ADD VALUE IF NOT EXISTS 'CONSERVATION';
