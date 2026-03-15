# Prive Deal Finder

Monorepo with Next.js frontend and NestJS backend.

## Apps
- `apps/web`: Deal Console (Next.js)
- `apps/api`: Deal Engine API (NestJS + Prisma)
- `packages/shared`: shared types

## Local development
1. Copy env files:
- `apps/api/.env.example` -> `apps/api/.env`
- `apps/web/.env.example` -> `apps/web/.env`
2. Install deps from repo root:
- `npm install`
3. Start local PostgreSQL:
- `npm run db:up`
4. Prepare Prisma client + migrations:
- `npm run setup`
5. Run dev servers:
- `npm run dev`

## Core API endpoints
- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/integrations/status`
- `GET /api/integrations/runs`
- `POST /api/integrations/:source/sync`
- `GET /api/reports/pipeline`
- `GET /api/reports/pipeline.csv`
- `GET /api/reports/pipeline.pdf`

## Quality commands
- `npm run verify`
- `npm run verify:local` (starts local DB + Prisma prep + full verify)
- `npm run test`
- `npm run test:e2e`
- `npm run test:ux` (Playwright UX smoke against Cloud Run web URL)
- `npm run smoke`
- `npm run go-live:check` (Cloud Run status + OAuth + smoke + UX + content quality)

## Notes
- Integrations use official sources only.
- API auth uses HttpOnly cookies with bearer fallback for backward compatibility.
- API routes are JWT-protected by default; only explicit auth/health routes are public.
- `POST /api/integrations/:source/sync` requires `ADMIN` role.
- See `docs/ACCESS_CHECKLIST.md` and `docs/LAUNCH_RUNBOOK.md`.
- User operations manual: `docs/USER_MANUAL.md`.
- Latest UX validation: `docs/UX_TEST_REPORT.md`.

## Repo independiente (push al remoto)

Este proyecto está en un repo propio. Para subir a GitHub:

1. Crea un repo nuevo en GitHub (ej. `prive-deal-finder` o `prive-deal-finder-app`).
2. Añade el remoto y haz push:

```bash
git remote add origin git@github.com:TU_ORG/prive-deal-finder.git
git push -u origin main
```

Sustituye `TU_ORG/prive-deal-finder` por la URL real del repo. Las variables y el token van en `apps/api/.env` y `apps/web/.env` (copiar desde los `.env.example`); no se suben al repo.

## Relación con PRIVE-GROUP-AI-PLATFORM

Este repo contiene **solo** lo que corresponde al producto Prive Deal Finder (api, web, integraciones, deploy a Cloud Run, docs de la app). Lo que es de la plataforma más amplia (hardware/DGX, n8n-workflows, cloud-functions, gas-consolidated, troubleshooting de red, etc.) sigue en **PRIVE-GROUP-AI-PLATFORM** y no se ha tocado ahí.

Si este proyecto necesita algo de esa plataforma (por ejemplo flujos n8n, scripts de GCP/hardware), se puede clonar o referenciar el repo [PRIVE-GROUP-AI-PLATFORM](https://github.com/jerabinovich/PRIVE-GROUP-AI-PLATFORM) junto a este, o copiar solo lo necesario.
