# BBS Coverage Audit

Date: 2026-02-11

## Scope
Miami-Dade PA BBS feature coverage against Prive Deal Finder implementation.

## Coverage Matrix
| Capability | Status | Notes |
|---|---|---|
| Parcel/property core (folio, address, municipality/use) | `PARTIAL` | Core fields present; richer mapping depends on dataset columns. |
| Ownership + mailing | `PARTIAL` | Owner entities linked; mailing address now stored at deal level. |
| Building facts (year built/area/features) | `PARTIAL` | Backfill + refresh implemented from connectors and MDPA rows. |
| Fiscal values / 3-year history | `PARTIAL` | `MdpaAssessment` model + API overview now available. |
| Sales history | `PARTIAL` | `MdpaSale` model + import path implemented. |
| Roll events PR/FC/FN | `PARTIAL` | `MdpaRollEvent` model + stage mapping implemented. |
| Main library metadata/versioning | `PARTIAL` | `MdpaDatasetSnapshot` tracks hash/date/file/source. |
| BBS catalog internal view | `IMPLEMENTED` | `GET /api/integrations/mdpa/catalog`. |
| Paid-data confirmation gate | `IMPLEMENTED` | Confirmation required before MDPA sync/import. |
| CREXi-like detail UX (facts/map/media/docs/comps/insights) | `PARTIAL` | Implemented layout + cards; data quality depends on ingestion completeness. |
| AVM/deal finder v1 | `PARTIAL` | Internal comps-based valuation in insights. |

## Endpoints Added/Updated
- `GET /api/integrations/mdpa/catalog`
- `POST /api/integrations/mdpa/import`
- `GET /api/deals/:id/overview` expanded with `ownership`, `facts`, `sales`, `assessments`, `completeness`
- `POST /api/deals/:id/recompute-comps` improved comparable address quality metadata
- `POST /api/deals/:id/recompute-insights` enhanced valuation payload

## Open Gaps
- Full parser coverage per official BBS file schema/version.
- Automated ingestion for all paid file types in production schedule (guarded by explicit confirmation policy).
- External demographics/climate providers for non-partial insights.
