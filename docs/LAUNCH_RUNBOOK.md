# Launch Runbook - Prive Deal Finder (Internal)

## 0) Persistencia tras reboot/logout (staging host)
- Ejecutar una sola vez con privilegios:
  - `sudo loginctl enable-linger privegroup`
- Verificar:
  - `loginctl show-user privegroup -p Linger`
  - Debe mostrar `Linger=yes`.

## 1) Pre-launch prerequisites
- PostgreSQL staging instance provisioned and reachable from API runtime.
- Staging secrets loaded (`DATABASE_URL`, JWT secrets, Google OAuth, integration URLs, MDPA path, auth cookie config, admin emails).
- Google OAuth redirect URIs configured for staging domain callback.
- MDPA production bulk file available for staging sync (no sample fallback in staging/prod).

## 1.1) Deploy en un solo comando
- En staging, desde el root del repo:
  - `npm run deploy:staging`
- Estado operativo:
  - `npm run staging:status`

## 2) Security checklist
- Rotate `GOOGLE_OAUTH_CLIENT_SECRET` immediately if it was exposed.
- Use non-default `JWT_SECRET` and `JWT_REFRESH_SECRET`.
- Set `AUTH_COOKIE_SECURE=true` on staging/prod.
- Confirm protected routes return `401` without bearer token.
- Confirm only public routes remain public:
  - `GET /api/health`
  - `POST /api/auth/login`
  - `POST /api/auth/refresh`
  - `POST /api/auth/logout`
  - `GET /api/auth/google`
  - `GET /api/auth/google/callback`
  - `GET /api/auth/google/status`

## 3) Startup and shutdown
- Start API: `npm run dev -w @prive/api` (local) or deploy API container/task (staging).
- Start web: `npm run dev -w @prive/web` (local) or deploy web app (staging).
- Stop local: terminate running processes (`Ctrl+C`).

## 4) Data operations
- `POST /api/integrations/:source/sync` requires `ADMIN` role.
- New deal-detail operations (ADMIN):
  - `POST /api/deals/:id/media`
  - `POST /api/deals/:id/documents`
  - `POST /api/deals/:id/recompute-comps`
  - `POST /api/deals/:id/recompute-insights`
- Read operations:
  - `GET /api/deals/:id/overview`
- Full sync manually:
  - `POST /api/integrations/mdpa/sync`
  - `POST /api/integrations/miami-dade-parcels/sync`
  - `POST /api/integrations/broward-parcels/sync`
  - `POST /api/integrations/palm-beach-parcels/sync`
- Run history and diagnostics:
  - `GET /api/integrations/runs?limit=50`
  - `GET /api/integrations/status`
- Re-sync policy:
  - If one source fails, keep app running and retry failed source only.

## 5) Validation before go/no-go
- API health: `GET /api/health` returns `status: ok`.
- Auth flow:
  - Login returns `{ accessToken, refreshToken, user }` and sets HttpOnly cookies.
  - Refresh returns new `{ accessToken, refreshToken, user }` and rotates cookies.
  - Logout revokes refresh token and clears cookies.
  - `GET /api/auth/me` works with bearer token.
- RBAC:
  - `ANALYST` gets `403` on `POST /api/integrations/:source/sync`.
  - `ADMIN` can trigger sync endpoints.
- Deals API returns paginated payload (`items`, `total`, `limit`, `offset`).
- Reports exports return non-empty content:
  - `GET /api/reports/pipeline.csv`
  - `GET /api/reports/pipeline.pdf`
- Integrations show successful runs for 24h period in staging.

## 6) Failure recovery
- Auth failures:
  - Verify OAuth client secret and redirect URI.
  - Verify JWT secrets are set and non-default.
- Integration failures:
  - Review `lastError` and `/integrations/runs` messages.
  - Re-run failed source sync after URL/credential fix.
- Database issues:
  - Restore from latest snapshot/backup.
  - Re-run syncs to repopulate non-critical staging data.

## 7) Smoke command
- Run from repo root (requires API up and an admin email in `AUTH_ADMIN_EMAILS`):
  - `npm run smoke`
- Smoke validates:
  - health
  - login + me + refresh
  - integration status and sync endpoints
  - reports endpoints

## 8) Go-live check (one command)
- Full production readiness check from repo root:
  - `PROJECT_ID=privegroup-cloud REGION=us-east1 npm run go-live:check`
- This command validates:
  - Cloud Run services status
  - Google OAuth status
  - API smoke flow
  - UX smoke flow (Playwright)
  - Content quality (`deals > 0` and records with non-empty address)

## 9) Daily automation (cron)
- Cron configurado para correr cada manana a las 08:00:
  - `0 8 * * * /bin/bash /Users/javierrabinovich/Documents/Prive\ AI\ DEAL\ FINDER/scripts/cron_go_live_report.sh >> /Users/javierrabinovich/Documents/Prive\ AI\ DEAL\ FINDER/docs/ops-reports/cron.log 2>&1`
- El cron ejecuta:
  - `node scripts/morning_refresh.js` (sync permitido + recompute comps/insights)
  - `npm run go-live:check`
- Reporte diario:
  - `docs/ops-reports/go-live-YYYY-MM-DD.md`
- Ultimo reporte:
  - `docs/ops-reports/LATEST.md`
