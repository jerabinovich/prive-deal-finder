-- CreateEnum
CREATE TYPE "DealMediaKind" AS ENUM ('PHOTO', 'VIDEO');

-- CreateEnum
CREATE TYPE "DealDocumentKind" AS ENUM ('OM', 'FLYER', 'BROCHURE', 'RENT_ROLL', 'OTHER');

-- AlterTable
ALTER TABLE "Deal"
ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION,
ADD COLUMN "lotSizeSqft" DOUBLE PRECISION,
ADD COLUMN "buildingSizeSqft" DOUBLE PRECISION,
ADD COLUMN "yearBuilt" INTEGER,
ADD COLUMN "zoning" TEXT,
ADD COLUMN "askingPrice" DOUBLE PRECISION,
ADD COLUMN "pricePerSqft" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "DealMedia" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "kind" "DealMediaKind" NOT NULL DEFAULT 'PHOTO',
    "url" TEXT NOT NULL,
    "caption" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealDocument" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "kind" "DealDocumentKind" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealComparable" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "distanceMiles" DOUBLE PRECISION,
    "salePrice" DOUBLE PRECISION,
    "pricePerSqft" DOUBLE PRECISION,
    "capRate" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealComparable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealInsight" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "demographicJson" TEXT,
    "climateRiskJson" TEXT,
    "valuationJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deal_assetType_market_idx" ON "Deal"("assetType", "market");

-- CreateIndex
CREATE INDEX "Deal_latitude_longitude_idx" ON "Deal"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "DealMedia_dealId_idx" ON "DealMedia"("dealId");

-- CreateIndex
CREATE INDEX "DealMedia_dealId_sortOrder_idx" ON "DealMedia"("dealId", "sortOrder");

-- CreateIndex
CREATE INDEX "DealDocument_dealId_idx" ON "DealDocument"("dealId");

-- CreateIndex
CREATE INDEX "DealComparable_dealId_idx" ON "DealComparable"("dealId");

-- CreateIndex
CREATE INDEX "DealComparable_dealId_distanceMiles_idx" ON "DealComparable"("dealId", "distanceMiles");

-- CreateIndex
CREATE UNIQUE INDEX "DealInsight_dealId_key" ON "DealInsight"("dealId");

-- CreateIndex
CREATE INDEX "DealInsight_updatedAt_idx" ON "DealInsight"("updatedAt");

-- AddForeignKey
ALTER TABLE "DealMedia" ADD CONSTRAINT "DealMedia_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealDocument" ADD CONSTRAINT "DealDocument_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealComparable" ADD CONSTRAINT "DealComparable_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealInsight" ADD CONSTRAINT "DealInsight_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
