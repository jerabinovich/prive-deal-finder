-- CreateEnum
CREATE TYPE "RollStage" AS ENUM ('PR', 'FC', 'FN');

-- AlterTable
ALTER TABLE "Deal"
ADD COLUMN "mailingAddress" TEXT,
ADD COLUMN "municipality" TEXT,
ADD COLUMN "propertyUseCode" TEXT,
ADD COLUMN "dataCompletenessScore" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "DealComparable"
ADD COLUMN "comparableDealId" TEXT,
ADD COLUMN "resolvedAddressConfidence" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "MdpaDatasetSnapshot" (
    "id" TEXT NOT NULL,
    "library" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "sourceUrl" TEXT,
    "sha256" TEXT,
    "recordCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MdpaDatasetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MdpaSale" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "saleDate" TIMESTAMP(3),
    "salePrice" DOUBLE PRECISION,
    "saleType" TEXT,
    "sourceSnapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MdpaSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MdpaAssessment" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "justValue" DOUBLE PRECISION,
    "assessedValue" DOUBLE PRECISION,
    "taxableValue" DOUBLE PRECISION,
    "rollStage" "RollStage",
    "sourceSnapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MdpaAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MdpaRollEvent" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3),
    "stage" "RollStage" NOT NULL,
    "justValue" DOUBLE PRECISION,
    "assessedValue" DOUBLE PRECISION,
    "taxableValue" DOUBLE PRECISION,
    "sourceSnapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MdpaRollEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DealComparable_comparableDealId_idx" ON "DealComparable"("comparableDealId");

-- CreateIndex
CREATE INDEX "MdpaDatasetSnapshot_library_snapshotDate_idx" ON "MdpaDatasetSnapshot"("library", "snapshotDate");

-- CreateIndex
CREATE INDEX "MdpaDatasetSnapshot_fileName_snapshotDate_idx" ON "MdpaDatasetSnapshot"("fileName", "snapshotDate");

-- CreateIndex
CREATE INDEX "MdpaSale_dealId_saleDate_idx" ON "MdpaSale"("dealId", "saleDate");

-- CreateIndex
CREATE INDEX "MdpaSale_saleDate_idx" ON "MdpaSale"("saleDate");

-- CreateIndex
CREATE INDEX "MdpaSale_sourceSnapshotId_idx" ON "MdpaSale"("sourceSnapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "MdpaAssessment_dealId_taxYear_rollStage_key" ON "MdpaAssessment"("dealId", "taxYear", "rollStage");

-- CreateIndex
CREATE INDEX "MdpaAssessment_dealId_taxYear_idx" ON "MdpaAssessment"("dealId", "taxYear");

-- CreateIndex
CREATE INDEX "MdpaAssessment_sourceSnapshotId_idx" ON "MdpaAssessment"("sourceSnapshotId");

-- CreateIndex
CREATE INDEX "MdpaRollEvent_dealId_eventDate_stage_idx" ON "MdpaRollEvent"("dealId", "eventDate", "stage");

-- CreateIndex
CREATE INDEX "MdpaRollEvent_sourceSnapshotId_idx" ON "MdpaRollEvent"("sourceSnapshotId");

-- AddForeignKey
ALTER TABLE "MdpaSale" ADD CONSTRAINT "MdpaSale_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MdpaSale" ADD CONSTRAINT "MdpaSale_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "MdpaDatasetSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MdpaAssessment" ADD CONSTRAINT "MdpaAssessment_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MdpaAssessment" ADD CONSTRAINT "MdpaAssessment_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "MdpaDatasetSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MdpaRollEvent" ADD CONSTRAINT "MdpaRollEvent_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MdpaRollEvent" ADD CONSTRAINT "MdpaRollEvent_sourceSnapshotId_fkey" FOREIGN KEY ("sourceSnapshotId") REFERENCES "MdpaDatasetSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
