-- 12-oct-2026: identidad estable de cada senal de distress en su fuente.
--
-- Antes la unica clave era (dealId, source, observedAt). Code enforcement de Miami-Dade manda
-- CASE_DATE en milisegundos, la fecha no se leia, caia en "ahora", y la misma violacion se
-- guardaba una vez por corrida: 9.283 filas para 279 casos el 12-oct. Contar filas convertia un
-- caso en "varias violaciones vigentes".
--
-- 1. externalId: el numero de caso (code enforcement: CASE_NUM:PROBLEM, igual que
--    IntegrationsService.distressExternalId; foreclosures: caseNumber).
-- 2. De cada caso queda la fila mas reciente, que es su estado actual; se borran las repeticiones.
-- 3. observedAt de code enforcement pasa a ser CASE_DATE, la fecha real del caso.
-- 4. La clave unica pasa a ser (dealId, source, externalId).

ALTER TABLE "DealDistressSignal" ADD COLUMN "externalId" TEXT;

UPDATE "DealDistressSignal" SET "externalId" = CASE
    WHEN source = 'miami-dade-code-enforcement' THEN
      NULLIF(btrim(substring(metadata from '"CASE_NUM":"([^"]*)"')), '')
        || COALESCE(':' || NULLIF(btrim(substring(metadata from '"PROBLEM":"([^"]*)"')), ''), '')
    ELSE NULLIF(btrim(COALESCE(
      substring(metadata from '"caseNumber":"([^"]*)"'),
      substring(metadata from '"CASE_NUM":"([^"]*)"'),
      substring(metadata from '"Case_Number":"([^"]*)"'))), '')
  END
WHERE metadata IS NOT NULL;

DELETE FROM "DealDistressSignal" d
USING "DealDistressSignal" k
WHERE d."externalId" IS NOT NULL
  AND k."dealId" = d."dealId"
  AND k.source = d.source
  AND k."externalId" = d."externalId"
  AND (k."updatedAt", k.id) > (d."updatedAt", d.id);

DROP INDEX "DealDistressSignal_dealId_source_observedAt_key";

UPDATE "DealDistressSignal"
SET "observedAt" = to_timestamp((substring(metadata from '"CASE_DATE":([0-9]{12,14})'))::bigint / 1000.0)
WHERE source = 'miami-dade-code-enforcement'
  AND metadata ~ '"CASE_DATE":[0-9]{12,14}';

CREATE UNIQUE INDEX "DealDistressSignal_dealId_source_externalId_key" ON "DealDistressSignal"("dealId", "source", "externalId");

CREATE INDEX "DealDistressSignal_dealId_source_observedAt_idx" ON "DealDistressSignal"("dealId", "source", "observedAt");
