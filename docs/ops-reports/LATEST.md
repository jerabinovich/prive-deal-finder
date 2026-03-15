# Ops Report (Latest)

Date: 2026-02-18
Environment: Cloud Run production (`privegroup-cloud`, `us-east1`)

## Deployment
- API revision: `prive-deal-finder-api-00086-jnr`
- Web revision: `prive-deal-finder-web-00033-s85`
- Cloud Run URLs:
  - API: `https://prive-deal-finder-api-ocita6cjaa-ue.a.run.app`
  - Web: `https://prive-deal-finder-web-ocita6cjaa-ue.a.run.app`

## Validation
- `npm run verify`: PASS
- `npm run test:e2e -w @prive/api`: PASS
- `npm run smoke` (local API): PASS
- `API_BASE=https://prive-deal-finder-api-ocita6cjaa-ue.a.run.app/api npm run smoke`: PASS
- `npm run test:ux`: PASS
- `PROJECT_ID=privegroup-cloud REGION=us-east1 npm run go-live:check`: PASS

## Operational triage
- New persisted fields in `Deal`:
  - `lane`, `recommendedAction`, `distressStage`, `nextEventDate`, `contactabilityScore`, `isNoise`, `noiseReason`, `laneUpdatedAt`
- New endpoint:
  - `POST /api/deals/recompute-triage`
- Noise policy active:
  - non-acquirable categories route to `NON_ACQUIRABLE_NOISE` + `ARCHIVE`

## UX/chat updates
- Deals table now includes lane/action/distress/contactability/noise columns and filters.
- Deal detail now includes top decision block (`¿Es oportunidad real?`) with reasons, blockers, and next action.
- Chat Copilot V2 now sends/receives contextual contract:
  - Request: `taskType + appState + uiCapabilities`
  - Response: legacy contract + `assistantMessageEs`, `taskTypeResolved`, `contextEcho`, `dataRequests`, `uiActions`, `quickReplies`, `memoryUpdate`, `guardrailsTriggered`
- Frontend now enforces confirmation before executing any AI-proposed action.

## Integrations control center
- Integration status rows now include portfolio actionability summary:
  - `% distress evidence`
  - `% with next event date`
  - `% contactable (score >= 50)`
- Recent runs now include operational interpretation:
  - `runType`, `severity`, `tableMessage`, `businessImpact`, `anomalies`, `nextActions`, `shouldAlert`.

## Go-live content snapshot
- `total`: 119
- `withAddress`: 67
- `withAssetType`: 81
- `withLot`: 34
- `withBldg`: 0
- `withYear`: 66
- `withPrice`: 36
- `classifications`: `WATCHLIST=118`, `TRUE_OPPORTUNITY=1`
- `lanes`: `OFF_MARKET_STANDARD=78`, `GOV_LAND_P3=14`, `NON_ACQUIRABLE_NOISE=27`
- chat probe: `intent=top_opportunities`, `lane=OFF_MARKET_STANDARD`, `PASS`

## Notes
- Distress confirmation remains evidence-driven; without official evidence it stays `not_confirmed_by_official_source`.
- Remaining data quality bottleneck: `buildingSizeSqft` coverage is still low in current source snapshots.
