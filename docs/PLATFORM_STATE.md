# PRIVE-GROUP-AI-PLATFORM — Estado Actual (2026-03-14)

## Repo
- GitHub: https://github.com/jerabinovich/PRIVE-GROUP-AI-PLATFORM
- Branch: main (ultimo commit: af25d89 — production hardening)
- Path en Spark: ~/github/jerabinovich/PRIVE-GROUP-AI-PLATFORM

## Stack
- **API**: NestJS v10, TypeScript, Prisma v5, PostgreSQL 16
- **Web**: Next.js 14, React 18, Tailwind CSS
- **Cache**: Redis 7 (Docker) con fallback in-memory
- **CI/CD**: GitHub Actions (lint + unit tests + integration tests + build)

## Servicios en Spark
| Servicio | Puerto | Notas |
|---------|------|-------|
| API (NestJS) | 4000 | `npm run dev -w @prive/api` |
| Web (Next.js) | 3000 | `npm run dev -w @prive/web` |
| PostgreSQL | 5432 | Docker container `prive-deal-finder-db` |
| Redis | 6379 | Docker container, `redis:7-alpine` |

## Mejoras implementadas (2026-03-13/14)

### Seguridad
- `helmet` en todos los requests
- Rate limiting: 200 req/min global, 10 req/min en auth endpoints
- Correlation-ID middleware (`x-request-id` header)

### API
- Health endpoints: `GET /api/health/live` y `GET /api/health/ready`
- Swagger docs en `/api/docs` (solo non-production)
- Manejo de uncaughtException / unhandledRejection

### DealsModule — Refactor completo
- `deals.service.ts`: 2640 → 364 líneas (orchestrator)
- 7 servicios especializados: facts, comparables, insights, triage, analysis, workflow, cache
- Ver ARCHITECTURE.md §5.1 para detalle

### Cache Redis
- `AppCacheModule` global con ioredis + fallback in-memory
- TTL: 2min (lista), 5min (facets/deal), invalidación por patrón en writes
- `DealsCacheService`: getList, getFacets, getDeal, invalidateLists, invalidateDeal, invalidateAll

### Tests
- Unit: 6 tests (auth service + MDPA ingest) — sin DB
- Integration/E2E: 33 tests cubriendo auth→deals CRUD→workflow→logout
- Configs separados: `jest.unit.config.js` / `jest.e2e.config.js`
- Comando: `npm run test:unit -w @prive/api` / `npm run test:e2e -w @prive/api`

### CI/CD
- GitHub Actions: 4 jobs (lint, unit-test, integration-test con postgres, build)
- Dependabot: weekly updates agrupados por nestjs/prisma/nextjs

### Web
- `@next/bundle-analyzer` instalado
- Comando de análisis: `npm run analyze -w @prive/web`

## Variables de entorno requeridas
Ver `apps/api/.env.example` para lista completa. Críticas:
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET`, `JWT_REFRESH_SECRET` — mínimo 32 chars
- `REDIS_HOST=127.0.0.1`, `REDIS_PORT=6379` (opcional, fallback in-memory si no hay Redis)
- `AUTH_ADMIN_EMAILS` — emails con rol ADMIN (comma-separated)
- `NODE_ENV=production` — activa CSP headers, desactiva Swagger

## Comandos útiles
```bash
# Desarrollo
npm run dev -w @prive/api    # API en :4000
npm run dev -w @prive/web    # Web en :3000

# Tests
npm run test:unit -w @prive/api   # unit (sin DB)
npm run test:e2e -w @prive/api    # integration (necesita DB)

# Build
npm run build -w @prive/api
npm run build -w @prive/web

# Bundle analysis
npm run analyze -w @prive/web

# DB
npm run prisma:generate -w @prive/api
npm run db:migrate:deploy -w @prive/api
```
