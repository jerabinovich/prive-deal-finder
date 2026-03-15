# UX Test Report - Prive Deal Finder

Date: 2026-02-18
Environment: Production (Cloud Run)

## 1. Objective
Validate unified table UX (filters/sort + labels + empty states) across Deals, Deal Detail, Integrations, and Reports.

## 2. Scope
Flows tested:
1. Login -> Deals list.
2. Deals column filters + sort + URL persistence.
3. Deal detail comparables/sales/assessments filters + sort.
4. Integrations status/runs filtering + runs sorting.
5. Reports filtering/sorting + CSV/PDF export.
6. Chat Copilot V2 contextual prompts (`taskType + appState`) and UI action confirmations.
7. Integrations Recent Runs operator insights (type/severity/impact/anomaly/next action).

## 3. Automated execution
- `npm run verify` -> PASS
- `npm run test:e2e -w @prive/api` -> PASS (`19 passed`)

## 4. Operational execution
- `API_BASE=... npm run smoke` -> PASS
- `npm run test:ux` -> PASS
- `PROJECT_ID=privegroup-cloud REGION=us-east1 npm run go-live:check` -> PASS

## 5. Validation matrix
- Deals headers renamed to business terms: PASS.
- Deals filters + sort available on all non-action columns: PASS.
- Cascading facets for Asset/Use Category: PASS.
- Deals operational triage columns render correctly (`Lane`, `Recommended Action`, `Distress Stage`, `Next Event`, `Contactability`, `Noise`): PASS.
- Noise-hidden default avoids non-acquirable rows by default: PASS.
- Comparables table has complete filter row and sortable headers: PASS.
- Sales table supports date/price/type filtering and sorting: PASS.
- Assessments table supports year/stage filtering and value sorting: PASS.
- Integrations status filters (configured/freshness/blocked): PASS.
- Recent runs filters + sort + readable metrics: PASS.
- Recent runs operational interpretation columns: PASS.
- Reports filters/sort + filtered exports: PASS.
- Deal detail top block explains “deal vs listing” with reasons/blockers/next action: PASS.
- Chat responses include Copilot V2 fields (`assistantMessageEs`, `contextEcho`, `dataRequests`, `uiActions`, `guardrailsTriggered`): PASS.
- All AI-suggested actions are confirmation-gated before execution: PASS.

## 6. Findings
Critical blockers:
- None.

Medium:
- Data completeness still source-dependent (some properties remain missing building/price/year fields).

## 7. UX acceptance
- Navigation clarity: PASS.
- Table usability/searchability: PASS.
- Opportunity interpretation support: PASS.

## 8. Go/No-Go
- **GO**
