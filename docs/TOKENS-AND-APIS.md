# Tokens y APIs — Mantener todo en marcha

Todos los **tokens**, **API keys** y **secretos** deben vivir en archivos **`.env`** locales. **Nunca** se suben al repo (están en `.gitignore`). Si faltan, la API o el front no arrancan o dejan de conectar con servicios externos.

## Dónde van los valores

| Ubicación | Uso |
|-----------|-----|
| `apps/api/.env` | Backend: DB, JWT, Google OAuth, integraciones, OpenAI, geocoding, Redis, etc. |
| `apps/web/.env` | Front: URL de la API, Maps embed, chat enable, timeout. |

Copiar desde `apps/api/.env.example` y `apps/web/.env.example` y reemplazar con valores reales.

---

## API (`apps/api/.env`)

### Obligatorios para que la app arranque
- **DATABASE_URL** — PostgreSQL (ej. `postgresql://user:pass@host:5432/dbname`).
- **JWT_SECRET** — Mínimo 16 caracteres (nunca el default).
- **JWT_REFRESH_SECRET** — Para refresh tokens.
- **WEB_APP_URL** — URL del front (ej. `http://localhost:3000` o la URL de Cloud Run web).
- **GOOGLE_OAUTH_CLIENT_ID** / **GOOGLE_OAUTH_CLIENT_SECRET** / **GOOGLE_OAUTH_REDIRECT_URI** — Login con Google.
- **MDPA_BULK_FILE_PATH** — Ruta al CSV de MDPA (puede ser un path local de prueba).
- **MIAMI_DADE_PARCELS_URL** / **BROWARD_PARCELS_URL** / **PALM_BEACH_PARCELS_URL** — URLs de datasets ArcGIS/parcels (requeridas por el validador de env).

### Para que las integraciones y features sigan funcionando
- **OPENAI_API_KEY** — Agentes / chat / scoring (si usas OpenAI).
- **AGENTS_V1_ENABLED** / **AGENTS_RESPONSES_ENABLED** — `true` si quieres el copilot activo.
- **GEOCODING_PROVIDER** / **GEOCODING_API_KEY** — Geocoding (ej. Google) si lo usas.
- **REDIS_HOST** / **REDIS_PORT** — Si usas cache Redis (opcional; default 127.0.0.1:6379).
- **MIAMI_DADE_FORECLOSURE_URL** / **MIAMI_DADE_FORECLOSURE_API_KEY** — Clerk/foreclosure si lo usas.
- **BROWARD_FORECLOSURE_URL** / **BROWARD_FORECLOSURE_API_KEY** — Broward foreclosure si lo usas.

### Cookies y auth
- **AUTH_ADMIN_EMAILS** — Emails separados por coma con rol admin.
- **AUTH_COOKIE_*** — Nombres y opciones de cookies (secure, same-site, domain) según entorno.

---

## Web (`apps/web/.env`)

- **NEXT_PUBLIC_API_URL** — Base URL de la API (ej. `http://localhost:4000` o `https://prive-deal-finder-api-xxx.run.app`).
- **NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY** — Para el mapa en detalle de deal (opcional).
- **NEXT_PUBLIC_CHAT_ENABLE** — `true` (default) para mostrar el panel de chat.
- **NEXT_PUBLIC_API_TIMEOUT_MS** — Timeout de requests (default 60000).

---

## Despliegue (Cloud Run)

En Cloud Run los env se inyectan desde Secret Manager o desde el script de deploy (`scripts/cloudrun_deploy.sh` genera YAML desde `apps/api/.env` y `apps/web/.env`). Asegurarse de que en el entorno de producción:

- Los mismos nombres de variables estén definidos.
- **GOOGLE_OAUTH_REDIRECT_URI** apunte a la URL pública de la API (ej. `https://prive-deal-finder-api-xxx.run.app/api/auth/google/callback`).
- **WEB_APP_URL** sea la URL del servicio web en Cloud Run.
- **DATABASE_URL** apunte a la instancia de producción (Cloud SQL o similar).

---

## Checklist rápido

- [ ] `apps/api/.env` existe y tiene al menos: DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET, Google OAuth, WEB_APP_URL, MDPA_BULK_FILE_PATH, parcel URLs.
- [ ] `apps/web/.env` existe y tiene NEXT_PUBLIC_API_URL (y Maps key si usas mapa).
- [ ] Ningún `.env` está en git (verificar con `git status`).
- [ ] En producción, env de API y Web configurados en Cloud Run (o el método que uses) con los mismos tokens/keys para que todo siga running.
