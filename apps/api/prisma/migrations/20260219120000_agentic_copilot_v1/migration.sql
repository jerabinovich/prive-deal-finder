-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RevenueSplitBasis') THEN
    CREATE TYPE "RevenueSplitBasis" AS ENUM ('NET_PROFIT');
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkflowTaskStatus') THEN
    CREATE TYPE "WorkflowTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELED');
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WorkflowTaskSource') THEN
    CREATE TYPE "WorkflowTaskSource" AS ENUM ('AGENT', 'SYSTEM', 'USER');
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AlertDelivery') THEN
    CREATE TYPE "AlertDelivery" AS ENUM ('IN_APP', 'DIGEST_DAILY');
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AlertSeverity') THEN
    CREATE TYPE "AlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
  END IF;
END $$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentRunStatus') THEN
    CREATE TYPE "AgentRunStatus" AS ENUM ('SUCCESS', 'ERROR', 'FALLBACK');
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "DealRevenueSplitConfig" (
  "id" TEXT NOT NULL,
  "dealId" TEXT NOT NULL,
  "operatorPct" DOUBLE PRECISION NOT NULL,
  "investorPct" DOUBLE PRECISION NOT NULL,
  "basis" "RevenueSplitBasis" NOT NULL DEFAULT 'NET_PROFIT',
  "minNetMarginPct" DOUBLE PRECISION,
  "minCloseProbPct" DOUBLE PRECISION,
  "metadata" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DealRevenueSplitConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DealWorkflowTask" (
  "id" TEXT NOT NULL,
  "dealId" TEXT NOT NULL,
  "lane" "DealLane",
  "taskType" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 3,
  "status" "WorkflowTaskStatus" NOT NULL DEFAULT 'TODO',
  "dueAt" TIMESTAMP(3),
  "ownerUserId" TEXT,
  "source" "WorkflowTaskSource" NOT NULL DEFAULT 'AGENT',
  "metadata" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DealWorkflowTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AlertRule" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "triggerType" TEXT NOT NULL,
  "market" TEXT,
  "lane" "DealLane",
  "active" BOOLEAN NOT NULL DEFAULT true,
  "delivery" "AlertDelivery" NOT NULL DEFAULT 'IN_APP',
  "configJson" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AlertEvent" (
  "id" TEXT NOT NULL,
  "dealId" TEXT,
  "triggerType" TEXT NOT NULL,
  "severity" "AlertSeverity" NOT NULL DEFAULT 'MEDIUM',
  "eventAt" TIMESTAMP(3) NOT NULL,
  "payloadJson" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AlertInboxItem" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "alertEventId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "channel" "AlertDelivery" NOT NULL DEFAULT 'IN_APP',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AlertInboxItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AgentRun" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT,
  "dealId" TEXT,
  "taskType" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "status" "AgentRunStatus" NOT NULL,
  "latencyMs" INTEGER,
  "tokenUsage" INTEGER,
  "inputHash" TEXT,
  "outputJson" TEXT,
  "guardrailsJson" TEXT,
  "toolCallsJson" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "DealRevenueSplitConfig_dealId_key" ON "DealRevenueSplitConfig"("dealId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DealWorkflowTask_dealId_status_priority_idx" ON "DealWorkflowTask"("dealId", "status", "priority");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DealWorkflowTask_ownerUserId_status_idx" ON "DealWorkflowTask"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DealWorkflowTask_createdAt_idx" ON "DealWorkflowTask"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AlertRule_userId_active_createdAt_idx" ON "AlertRule"("userId", "active", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AlertEvent_dedupeKey_key" ON "AlertEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AlertEvent_dealId_eventAt_idx" ON "AlertEvent"("dealId", "eventAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AlertEvent_triggerType_eventAt_idx" ON "AlertEvent"("triggerType", "eventAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AlertInboxItem_userId_alertEventId_key" ON "AlertInboxItem"("userId", "alertEventId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AlertInboxItem_userId_readAt_createdAt_idx" ON "AlertInboxItem"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentRun_userId_taskType_createdAt_idx" ON "AgentRun"("userId", "taskType", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentRun_dealId_createdAt_idx" ON "AgentRun"("dealId", "createdAt");

-- AddForeignKey
ALTER TABLE "DealRevenueSplitConfig"
  ADD CONSTRAINT "DealRevenueSplitConfig_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealWorkflowTask"
  ADD CONSTRAINT "DealWorkflowTask_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealWorkflowTask"
  ADD CONSTRAINT "DealWorkflowTask_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertRule"
  ADD CONSTRAINT "AlertRule_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent"
  ADD CONSTRAINT "AlertEvent_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertInboxItem"
  ADD CONSTRAINT "AlertInboxItem_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertInboxItem"
  ADD CONSTRAINT "AlertInboxItem_alertEventId_fkey"
  FOREIGN KEY ("alertEventId") REFERENCES "AlertEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun"
  ADD CONSTRAINT "AgentRun_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun"
  ADD CONSTRAINT "AgentRun_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun"
  ADD CONSTRAINT "AgentRun_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
