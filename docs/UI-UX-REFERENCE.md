# UI & UX Reference — Ambas versiones son útiles

Tanto la **v1 (legacy, single-page)** como la **app actual (Next.js)** aportan patrones y decisiones de UI/UX valiosos. Este doc los resume para tener una referencia única al evolucionar el producto.

---

## 1. App actual (Next.js) — UI/UX de referencia

**Ubicación:** `apps/web/`  
**Stack:** Next.js (App Router), React, Tailwind CSS, Plus Jakarta Sans.

### Shell y navegación
- **Topbar fija:** gradiente oscuro (`#0f172a` → `#1e3a8a` → `#312e81`), brand “Prive Deal Finder”, `TopNav` con Deals, Reports, Integrations, Logout.
- **Auth:** Login obligatorio; rol visible en nav (ADMIN / ANALYST / PARTNER). Estado de sesión (“Session…” mientras carga).
- **Layout:** `app-shell` → header + `main.container.page-content` + panel de chat flotante.

### Paleta y tipografía
- **CSS variables** en `globals.css`: `--bg`, `--surface`, `--text`, `--muted`, `--border`, `--primary`, `--accent`, `--success`, `--warning`, `--danger`.
- **Fondo:** radial gradient sutil + `--bg`. Tipografía: Plus Jakarta Sans.
- **Contenedor:** `max-width: 1200px`, padding 24px.

### Deals (lista)
- **DealsClient:** tabla con `DataTableShell`, `ColumnHeaderSort` (name, market, assetType, score, classification, lane, recommendedAction, distressStage, nextEventDate, contactabilityScore, status, updatedAt).
- **Filtros:** `TableFilterRow` con facetas desde API (market, assetType, classification, lane, etc.) y búsqueda.
- **Empty state:** `TableEmptyState` cuando no hay resultados.
- **Filas clickeables** → navegación a `/deals/[id]`.

### Deal detalle (`/deals/[id]`)
- Página completa con datos del deal: dirección, market, asset type, scores, classification, lane, recommended action, distress stage, owners, pain points, coordenadas, lot/building size, year built, zoning, precios, media (fotos/videos), documentos (OM, flyer, etc.).
- **Google Maps embed** (si hay `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY`) con lat/lng.
- Tabs o secciones para organizar mucha información.
- Integración con **Chat/copilot** (contexto del deal para preguntas y siguientes pasos).

### Reports
- **ReportsClient:** tabla de pipeline por status (count, avgScore), filtros por status y min count, orden por status/count/avgScore.
- **Export:** CSV y PDF desde API (`/api/reports/pipeline.csv`, `.pdf`).

### Integrations
- **IntegrationsClient:** estado de integraciones (MDPA, Broward, etc.), runs, controles de sync (admin).

### Chat / Copilot
- **PriveChatPanel:** panel flotante (chat con backend de agentes).
- **ChatContextProvider:** comparte estado (deal actual, etc.) con el chat para respuestas contextuales.
- Mensajes con intent, thesis, nextAction, confidence, lane, metrics, workflow tasks, economics, split outcome, quick replies, acciones UI.

### Feedback y estado
- **ToastProvider:** notificaciones (éxito, error) para acciones (guardar, sync, etc.).
- Loading states en tablas y páginas.

### Componentes reutilizables
- `ColumnHeaderSort`, `DataTableShell`, `TableFilterRow`, `TableEmptyState`, `TopNav`, `ToastProvider`, `ChatContextProvider`, `PriveChatPanel`.

---

## 2. Legacy v1 (single-page) — UI/UX de referencia

**Ubicación:** `docs/legacy-v1/index-v1.html` (y descripción en `docs/legacy-v1/LOG-ACTIVIDAD.md`).

### Shell
- Header fijo: logo “PRIVE DEAL FINDER”, stats (Total deals, Priority 90+, Pipeline value), botones Map / Export CSV / Report.
- **Sidebar fija** (280px): filtros por Market, Asset Type, Pain Point, Min Deal Score (slider 70–100), Max Cap Rate, “Reset All Filters”.

### Data Pipeline Status
- Panel con “pills”: Miami-Dade Appraiser, CoStar, Public Records, Google Maps, Lender DB, Repliers.com.
- Cada uno con dot verde (activo) o amarillo (pendiente). Muy escaneable.

### Deal cards (grid)
- Grid `repeat(auto-fill, minmax(320px, 1fr))`.
- **Card:** imagen placeholder (gradiente), badge circular de **score** con borde dorado, tag de asset type, market en dorado, título, value y cap, **pain tags** en rojo.
- Hover: elevación y sombra.

### Modal de detalle
- Al click en card: overlay + modal con Investment thesis, Property metrics (grid), Risk factors, **Owner intelligence** (entity, principal, phone, email, tenure).
- **Google Maps** y **Street View** con links por coordenadas.
- **Quick Outreach:** plantillas Email / SMS / WhatsApp con copy to clipboard.

### Export y report
- **Export CSV:** columnas Market, Type, Score, Title, Value, Cap, Owner, Phone, Email.
- **Generate Report:** alert con resumen (total opportunities, aggregate value, avg score, top markets, primary pain).

### Estilo v1
- Variables: `--primary`, `--gold`, `--bg`, `--success`, `--warn`, `--danger`, `--sidebar`, `--header`.
- Tipografía Inter (system-ui). Filtros con labels en mayúsculas, pequeños, color muted.

---

## 3. Cómo combinar lo mejor de ambas

| Idea / Patrón | Origen | Uso sugerido en app actual |
|---------------|--------|----------------------------|
| Pipeline status con pills (conectores) | v1 | Añadir en dashboard o Integrations un panel tipo “Data Pipeline Status” con estado real por integración. |
| Score badge circular con borde destacado | v1 | En lista de deals o cards, mostrar score con el mismo énfasis visual. |
| Pain tags muy visibles (rojo) | v1 | En tabla o cards, destacar pain points / distress como en v1. |
| Owner intelligence en bloque (entity, principal, phone, email, tenure) | v1 | En detalle de deal, sección fija “Owner intelligence” con ese formato. |
| Outreach Email/SMS/WhatsApp + copy | v1 | En detalle o desde chat: botones que generen plantillas y “Copy” (ya hay lógica en backend/chat). |
| Sidebar de filtros siempre visible | v1 | Opción de layout: sidebar fija en /deals con filtros clave (market, type, score, pain). |
| Export CSV + Report resumen | Ambas | Ya existe; revisar columnas y resumen para alinearlos con v1 si aporta. |
| Tabla con sort + filtros por facetas | Actual | Mantener como base; añadir filtros “pain”/distress si no están. |
| Chat contextual por deal | Actual | Mantener; puede disparar outreach o sugerir siguiente paso. |
| Roles y auth en nav | Actual | Mantener. |
| Design system (variables, Tailwind) | Actual | Mantener como base; importar detalles de v1 (gold, badges) donde encaje. |

---

## 4. Dónde está cada cosa en el repo

- **App actual (UI/UX):** `apps/web/app/` (páginas y componentes), `apps/web/app/globals.css`.
- **Legacy v1 (UI/UX):** `docs/legacy-v1/index-v1.html`, `docs/legacy-v1/LOG-ACTIVIDAD.md`, `docs/legacy-v1/README.md`.

Ambas UIs son referencia válida para diseño y evolución del producto.
