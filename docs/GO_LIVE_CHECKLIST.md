# GO LIVE Checklist - Prive Deal Finder

Date: 2026-02-18
Environment: Cloud Run production (`privegroup-cloud`, `us-east1`)

## A. Service status
- [x] API service `STATUS=True`
- [x] Web service `STATUS=True`
- [x] API health `200`
- [x] OAuth status `enabled=true`

## B. Functional checks
- [x] `npm run verify` PASS
- [x] `npm run test:e2e -w @prive/api` PASS
- [x] `API_BASE=... npm run smoke` PASS
- [x] `npm run test:ux` PASS
- [x] `PROJECT_ID=privegroup-cloud REGION=us-east1 npm run go-live:check` PASS
- [x] `go-live:check` reports lane summary and chat lane field PASS
- [x] Chat `/api/chat/query` returns legacy + Copilot V2 fields in one response PASS
- [x] Integrations `/api/integrations/runs` returns operator insights (`runType`, `severity`, `tableMessage`, `nextActions`) PASS

## C. Table/filter/sort checks
- [x] Deals table supports column filters and sort for all data columns.
- [x] Deals table supports operational filters: `lane`, `recommendedAction`, `distressStage`, `ownerType`, `isNoise`.
- [x] Deals URL preserves filters/sort and pagination.
- [x] Comparables table supports combined filters + sorting.
- [x] Sales and Assessments tables support local filtering/sorting.
- [x] Integrations status table supports operational filters.
- [x] Integrations runs table supports date/status/source/message filters + sort.
- [x] Integrations runs table surfaces operator insights before raw metrics.
- [x] Reports table supports filter/sort and filtered export outputs.

## D. API query checks
- [x] `/api/deals` triage query params validated.
- [x] `/api/deals/recompute-triage` validated (ADMIN).
- [x] `/api/deals/:id/opportunity-summary` returns lane/action/noise fields.
- [x] `/api/deals/:id/overview` returns `operationalDecision` and `investmentThesisV2`.
- [x] `/api/integrations/status` query params validated.
- [x] `/api/integrations/runs` query params validated.
- [x] `/api/integrations/runs?operatorView=true` validated with operational insight fields.
- [x] `/api/reports/pipeline` query params validated.
- [x] `/api/reports/pipeline.csv|pdf` filtered export validated.

## E. Accessibility and clarity checks
- [x] Filter controls have `aria-label`.
- [x] `Unavailable` replaces ambiguous empty placeholders.
- [x] Empty states include next action.
- [x] Chat returns `thesis + 3 metrics + 1 action` and lane when context is available.
- [x] Chat returns `uiActions` and frontend requires explicit confirmation before executing each action.

## Final decision
- **GO-LIVE: PASS**
