-- CreateTable
CREATE TABLE "DealDistressSignal" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "confidence" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealDistressSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DealDistressSignal_dealId_source_observedAt_key" ON "DealDistressSignal"("dealId", "source", "observedAt");

-- CreateIndex
CREATE INDEX "DealDistressSignal_dealId_observedAt_idx" ON "DealDistressSignal"("dealId", "observedAt");

-- CreateIndex
CREATE INDEX "DealDistressSignal_status_observedAt_idx" ON "DealDistressSignal"("status", "observedAt");

-- AddForeignKey
ALTER TABLE "DealDistressSignal" ADD CONSTRAINT "DealDistressSignal_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
