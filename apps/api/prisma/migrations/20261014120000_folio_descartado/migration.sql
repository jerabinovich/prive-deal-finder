-- 14-oct-2026: folios que JR pidio sacar del Deal Finder. La ingesta de parcelas no los vuelve a crear
-- (src/integrations/descartados.ts). Primer caso: 401 Biscayne Blvd, que el sync de Miami-Dade recreaba cada dia.
CREATE TABLE "FolioDescartado" (
    "id" TEXT NOT NULL,
    "parcelId" TEXT NOT NULL,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FolioDescartado_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FolioDescartado_parcelId_key" ON "FolioDescartado"("parcelId");
