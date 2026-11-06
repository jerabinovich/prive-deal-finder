-- 6-nov-2026 (JR): patrimonio estimado en el score. Solo agrega columnas que admiten nulo: nada existente cambia.
ALTER TABLE "Deal" ADD COLUMN "equityRatio" DOUBLE PRECISION, ADD COLUMN "equityConfidence" TEXT;
