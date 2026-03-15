# MDPA BBS Credit Protection Policy

Last update: 2026-02-10

## Scope
- Source: Miami-Dade Property Appraiser BBS bulk downloads.
- This source is paid (credits model) and must be handled with explicit operator confirmation.

## Credit model
- Reference conversion: `1 USD = 1 credit`.
- Typical minimum file cost: `50 credits`.
- Credits are non-refundable in normal scenarios.

## Operational rules
1. Download docs/readme before any paid file cycle.
2. One paid dataset per cycle unless explicitly approved.
3. Keep order/payment evidence and source snapshot metadata.
4. Never trigger paid-data workflows without explicit confirmation.

## App enforcement (current implementation)
- Endpoint: `POST /api/integrations/mdpa/sync`
- Requires body: `{"confirmPaidDataUse": true}` when `MDPA_REQUIRE_CONFIRMATION=true`.
- If missing confirmation, API returns `400` with explicit instruction.
- Integrations UI shows a confirmation dialog before MDPA sync.

## Environment controls
- `MDPA_REQUIRE_CONFIRMATION=true` (default)
- `MDPA_ESTIMATED_CREDITS=50` (default)

## Notes
- Current app syncs from an already available CSV (`MDPA_BULK_FILE_PATH` or fallback seed).
- The app does not perform BBS payment transactions directly.
- If a direct BBS downloader is added later, keep this confirmation gate and add pre-flight credit checks.
