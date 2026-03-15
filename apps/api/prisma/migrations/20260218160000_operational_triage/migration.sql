-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DealLane') THEN
    CREATE TYPE "DealLane" AS ENUM (
      'DISTRESS_OWNER',
      'AUCTION_MONITOR',
      'GOV_LAND_P3',
      'OFF_MARKET_STANDARD',
      'NON_ACQUIRABLE_NOISE',
      'RESEARCH_REQUIRED'
    );
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecommendedAction') THEN
    CREATE TYPE "RecommendedAction" AS ENUM (
      'CONTACT_NOW',
      'MONITOR',
      'AUCTION_PREP',
      'GOV_PURSUE',
      'RESEARCH',
      'ARCHIVE'
    );
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DistressStage') THEN
    CREATE TYPE "DistressStage" AS ENUM (
      'NONE',
      'SIGNALS_ONLY',
      'PRE_FORECLOSURE',
      'AUCTION_SCHEDULED',
      'AUCTION_POSTPONED_OR_CANCELLED',
      'REO_BANK_OWNED',
      'SHORT_SALE_ACTIVE',
      'TAX_SALE_PROCESS',
      'PROBATE_ESTATE',
      'CODE_ENFORCEMENT',
      'BANKRUPTCY',
      'GOVERNMENT_LAND',
      'UNKNOWN'
    );
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NoiseReason') THEN
    CREATE TYPE "NoiseReason" AS ENUM (
      'COMMON_AREA',
      'ROADWAY',
      'RAILROAD',
      'CENTRALLY_ASSESSED',
      'UTILITY',
      'UNKNOWN'
    );
  END IF;
END $$;

-- AlterTable
ALTER TABLE "Deal"
  ADD COLUMN IF NOT EXISTS "lane" "DealLane" DEFAULT 'RESEARCH_REQUIRED',
  ADD COLUMN IF NOT EXISTS "recommendedAction" "RecommendedAction" DEFAULT 'RESEARCH',
  ADD COLUMN IF NOT EXISTS "distressStage" "DistressStage" DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS "nextEventDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "contactabilityScore" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "isNoise" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "noiseReason" "NoiseReason",
  ADD COLUMN IF NOT EXISTS "laneUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DealEvent" (
  "id" TEXT NOT NULL,
  "dealId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "eventDate" TIMESTAMP(3) NOT NULL,
  "source" TEXT,
  "reference" TEXT,
  "confidence" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DealEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DealDecisionAudit" (
  "id" TEXT NOT NULL,
  "dealId" TEXT NOT NULL,
  "classification" TEXT NOT NULL,
  "lane" "DealLane" NOT NULL,
  "recommendedAction" "RecommendedAction" NOT NULL,
  "reasoningJson" TEXT NOT NULL,
  "engineVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DealDecisionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Deal_lane_recommendedAction_market_updatedAt_idx" ON "Deal"("lane", "recommendedAction", "market", "updatedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Deal_isNoise_updatedAt_idx" ON "Deal"("isNoise", "updatedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Deal_nextEventDate_idx" ON "Deal"("nextEventDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DealEvent_dealId_eventDate_idx" ON "DealEvent"("dealId", "eventDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DealEvent_eventType_eventDate_idx" ON "DealEvent"("eventType", "eventDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DealDecisionAudit_dealId_createdAt_idx" ON "DealDecisionAudit"("dealId", "createdAt");

-- AddForeignKey
ALTER TABLE "DealEvent"
  ADD CONSTRAINT "DealEvent_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealDecisionAudit"
  ADD CONSTRAINT "DealDecisionAudit_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
