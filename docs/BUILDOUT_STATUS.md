# Buildout Status - Prive Deal Finder

Last updated: 2026-02-18
Environment: Cloud Run production (`privegroup-cloud`, `us-east1`)

## Scope delivered in this pass
- Unified table UX standard across Deals, Deal Detail, Integrations, Reports.
- Column-level filters and sortable headers with consistent labels.
- Server-side filtering/sorting extensions for Integrations and Reports APIs.
- Deals API/UI sorting support and URL persistence for filters/sort/pagination.
- Detail page local analytical filtering for Comparables, Sales, Assessments.
- Reusable table UI components for consistency.
- Operational triage layer persisted in DB (`lane`, `recommendedAction`, `distressStage`, noise fields).
- New endpoint `POST /api/deals/recompute-triage` for batch lane/action recompute.
- Chat response contract expanded to Copilot V2:
  - `assistantMessageEs`, `taskTypeResolved`, `contextEcho`, `dataRequests`, `uiActions`, `quickReplies`, `memoryUpdate`, `guardrailsTriggered`
  - legacy fields preserved for non-breaking rollout.
- Integrations runs now include operator insights:
  - `runType`, `severity`, `tableMessage`, `businessImpact`, `anomalies`, `nextActions`, `shouldAlert`, `alertReason`.

## API status
- [x] `GET /api/deals` supports sorting:
  - `sortBy=name|market|assetType|propertyUseCode|score|classification|lane|recommendedAction|distressStage|nextEventDate|contactabilityScore|status|updatedAt`
  - `sortDir=asc|desc`
- [x] `GET /api/deals` supports triage filters:
  - `lane`, `recommendedAction`, `distressStage`, `ownerType`, `contactability`, `isNoise`, `nextEventFrom`, `nextEventTo`
- [x] `GET /api/deals/:id/opportunity-summary` includes:
  - `lane`, `recommendedAction`, `distressStage`, `nextEvent`, `contactability`, `isNoise`, `noiseReason`, `blockers`
- [x] `GET /api/deals/:id/overview` includes:
  - `operationalDecision`, `investmentThesisV2`
- [x] `POST /api/deals/recompute-triage` available for ADMIN
- [x] `GET /api/integrations/status` supports optional filters:
  - `source`, `category`, `configured`, `status`, `freshness`, `blocked`
- [x] `GET /api/integrations/runs` supports optional filters/sort:
  - `source`, `status`, `message`, `dateFrom`, `dateTo`, `limit`, `offset`, `sortBy`, `sortDir`, `operatorView`
- [x] `GET /api/reports/pipeline` supports optional filters/sort:
  - `status`, `minCount`, `sortBy`, `sortDir`
- [x] `GET /api/reports/pipeline.csv` and `pipeline.pdf` accept same query and export filtered view.

## Shared types status
- [x] Added in `packages/shared/src/index.ts`:
  - `SortDir`, `SortSpec`, `TableFilterState`
  - `IntegrationStatusQuery`, `IntegrationRunsQuery`, `PipelineReportQuery`
  - `DealLane`, `RecommendedAction`, `DistressStage`, `NoiseReason`, `OperationalDecision`, `TriageResult`
  - `ChatTaskType`, `ChatAppStateInput`, `CopilotDataRequest`, `CopilotUiAction`, `CopilotMemoryUpdate`, `IntegrationRunInsight`

## UI status by table
- [x] Deals table: filters + sort + URL persistence
- [x] Deals table: lane/action/distress/contactability/noise columns + quick lane presets
- [x] Comparables table: filters + sort + source normalization + confidence display
- [x] Sales table: filters + sort
- [x] Assessments table: filters + sort
- [x] Integrations status table: filters + operational labels
- [x] Integrations runs table: filters + sort + key/value metrics render
- [x] Integrations runs table: operator insight columns (run type/severity/impact/anomaly/next action)
- [x] Chat panel: context-aware Copilot V2 payload (`taskType + appState + uiCapabilities`) and confirmation-gated action execution
- [x] Reports table: filters + sort + filtered exports

## Reusable components
- [x] `apps/web/app/components/DataTableShell.tsx`
- [x] `apps/web/app/components/ColumnHeaderSort.tsx`
- [x] `apps/web/app/components/TableFilterRow.tsx`
- [x] `apps/web/app/components/TableEmptyState.tsx`

## Quality gates
- [x] `npm run verify`
- [x] `npm run test:e2e -w @prive/api`
- [x] `API_BASE=... npm run smoke`
- [x] `npm run test:ux`
- [x] `PROJECT_ID=privegroup-cloud REGION=us-east1 npm run go-live:check`

## Residual gaps
- Data completeness remains source-dependent for some fields.
- Distress source quality still depends on external coverage and API unit availability.
