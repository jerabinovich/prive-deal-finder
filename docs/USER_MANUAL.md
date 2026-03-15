# User Manual - Prive Deal Finder

Updated: 2026-02-18

## 1. Access
1. Open app: `https://prive-deal-finder-web-ocita6cjaa-ue.a.run.app`
2. Login at `/login` with corporate email.
3. Default landing page: `/deals`.

## 2. Table standard (all key pages)
The app now uses one consistent table pattern:
- Clear headers with business meaning and units.
- Filter row under headers.
- Sortable columns with arrow state.
- `Unavailable` instead of `-`.
- Empty states with suggested next action.

Filter mode:
- Server-backed tables (`Deals`, `Integrations`, `Reports`): use `Apply Filters` / `Reset`.
- Local detail tables (`Comparables`, `Sales`, `Assessments`): immediate filter/sort.

## 3. Deals page (`/deals`)
Headers:
- `Property Name`, `Market`, `Asset Type`, `Use Category`, `Pipeline Score`, `Opportunity Class`, `Lane`, `Recommended Action`, `Distress Stage`, `Next Event`, `Contactability`, `Noise`, `Stage`, `Actions`.

What you can do:
- Filter by each column.
- Sort by all data columns except `Actions`.
- Keep filters/sort in URL.
- Use cascade options for `Asset Type` and `Use Category`.
- Use quick presets: `Distress`, `Off-market`, `Gov/P3`, `Noise Hidden`.
- Noise is hidden by default (`isNoise=false`) unless changed in filters.

## 4. Deal detail (`/deals/:id`)
Main analytical order:
1. Decision header (`¿Es oportunidad real?`) with lane/action/blockers
2. Opportunity Snapshot
3. Investment Thesis
4. Data Quality
5. Property Facts
6. Comparables
7. Sales & Tax History
8. Insights

### Comparables
- Sort by address, distance, sale price, price/sqft, cap rate, quality, source.
- Filter by text, distance, price ranges, price/sqft ranges, cap rate ranges, quality, source.
- Shows `Address confidence` when available.

### Sales history
- Filter by date range, sale price range, sale type.
- Sort by sale date, sale price, sale type.

### Tax assessment history
- Filter by year range and roll stage.
- Sort by year, stage, just/assessed/taxable values.

## 5. Integrations (`/settings/integrations`)
### Integration Status table
- Filters: source, domain/category, configured, runtime status, freshness, blocked.
- Columns renamed for operations clarity.

### Recent Runs table
- Filters: source, status, date range, message contains.
- Sort by source, status, started, ended.
- Operational columns:
  - `Run Type` (`CONNECTIVITY_CHECK|SAMPLE_SYNC|FULL_SYNC|BULK_INGEST`)
  - `Severity` (`LOW|MEDIUM|HIGH`)
  - `Operational Message` (business-readable)
  - `Business Impact` (`new/updated/owner-linked`)
  - `Risk / Anomaly` + `Next Action`
- Raw metrics remain available in the last column for deep debug.

## 6. Reports (`/reports`)
Pipeline report now supports:
- Filters: status and minimum deal count.
- Sort by pipeline stage, deal count, average pipeline score.
- CSV/PDF exports honor active filters/sort.

## 7. Chat panel (ChatGPT)
Available in:
- `/deals`
- `/deals/:id`
- `/reports`
- `/settings/integrations`

Request contract (per turn):
- `message + taskType + appState + uiCapabilities`
- `appState` includes route, filters, visible pipeline rows, integrations snapshot, recent runs.

Response contract (backward compatible):
- Legacy fields still returned: `answer`, `intent`, `thesis`, `nextAction`, `lane`, `metrics`, `decisionBlockers`, `citations`, `suggestedActions`.
- V2 fields:
  - `assistantMessageEs`
  - `taskTypeResolved`
  - `contextEcho`
  - `dataRequests[]`
  - `uiActions[]`
  - `quickReplies[]`
  - `memoryUpdate`
  - `guardrailsTriggered[]`

Execution policy:
- Every AI-proposed UI action is confirmation-gated in frontend before execution.

## 8. Operational checks
- `npm run verify`
- `API_BASE="https://prive-deal-finder-api-ocita6cjaa-ue.a.run.app/api" npm run smoke`
- `npm run test:ux`
- `PROJECT_ID=privegroup-cloud REGION=us-east1 npm run go-live:check`
