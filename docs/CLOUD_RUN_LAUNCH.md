# Cloud Run Launch (Option A)

This document deploys `api` + `web` to Google Cloud Run with PostgreSQL on Cloud SQL.

## Prerequisites
- Google Cloud project with billing enabled.
- `gcloud` CLI installed and authenticated.
- Local files present:
  - `apps/api/.env`
  - `apps/web/.env`
- Required values in `apps/api/.env`:
  - `JWT_SECRET`, `JWT_REFRESH_SECRET`
  - `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`
  - `MDPA_BULK_FILE_PATH`
  - `MIAMI_DADE_PARCELS_URL`, `BROWARD_PARCELS_URL`, `PALM_BEACH_PARCELS_URL`

## Deploy
Run from repo root:

```bash
chmod +x scripts/cloudrun_deploy.sh scripts/cloudrun_status.sh
PROJECT_ID=privegroup-cloud REGION=us-east1 bash ./scripts/cloudrun_deploy.sh
```

Default deploy mode is authenticated Cloud Run (`--no-allow-unauthenticated`).
Default deploy mode also disables Cloud Run invoker IAM check (`DISABLE_INVOKER_IAM_CHECK=true`) so browser access does not return `403 Forbidden`.
If your org policy allows public services and you need public access:

```bash
ALLOW_UNAUTHENTICATED=true PROJECT_ID=privegroup-cloud REGION=us-east1 bash ./scripts/cloudrun_deploy.sh
```

Outputs include:
- `API_URL`
- `WEB_URL`
- `GOOGLE_REDIRECT_URI`
- `JS_ORIGIN`

The deploy also runs Prisma migrations via Cloud Run Job:
- `prive-deal-finder-migrate` (configurable with `MIGRATE_JOB`)

## Google OAuth configuration
In Google Cloud Console > APIs & Services > Credentials > OAuth 2.0 Client (Web):

- `Authorized JavaScript origins`:
  - `JS_ORIGIN` output from deploy (web URL)
- `Authorized redirect URIs`:
  - `GOOGLE_REDIRECT_URI` output from deploy (api URL + callback path)

## Verify

```bash
PROJECT_ID=privegroup-cloud REGION=us-east1 bash ./scripts/cloudrun_status.sh
API_BASE="https://<API_URL>/api" SMOKE_EMAIL="admin@privegroup.com" npm run smoke
npm run test:ux
PROJECT_ID=privegroup-cloud REGION=us-east1 npm run go-live:check
```

Expect:
- Cloud Run services listed and ready.
- `GET /api/health` returns `200` (using ID token when service is private).
- `/api/auth/google/status` returns `enabled: true`.
- `npm run smoke` completes end-to-end (login, auth/me, integrations sync, reports, logout).

## Notes
- The deploy script sets:
  - `AUTH_COOKIE_SECURE=true`
  - `AUTH_COOKIE_SAME_SITE=none`
- This is required when web and api run on different Cloud Run domains.
- If your organization blocks `allUsers` IAM bindings, Cloud Run services will be private by policy.
