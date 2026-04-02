# MORNING BRIEF — UI/UX SPEC
**Version:** v1.0  
**Date:** 2026-03-16  
**Project:** prive-deal-finder / `apps/web`  
**Route:** `/morning-brief` (or `/` if set as default dashboard)  
**Cron trigger:** OpenClaw Gateway → `30 6 * * *` ET

---

## Overview

The Morning Brief is a read-only, auto-generated daily dashboard delivered every morning at 6:30 AM ET. Its aesthetic and layout mirrors the **Deal Finder** UI — dark background, card-based layout, tight typography, status badges. The goal is a single-screen operational snapshot JR can review in under 2 minutes.

---

## Design System (Match Deal Finder)

| Token | Value |
|-------|-------|
| Background | `#0a0a0f` |
| Surface | `#111118` |
| Surface elevated | `#18181f` |
| Border | `#2a2a35` |
| Text primary | `#f0f0f5` |
| Text secondary | `#8888a0` |
| Accent blue | `#4f8ef7` |
| Accent green | `#22c55e` |
| Accent yellow | `#eab308` |
| Accent red | `#ef4444` |
| Accent orange | `#f97316` |
| Font — display | `'DM Mono'` or `'JetBrains Mono'` |
| Font — body | `'Inter'` (14px, 400/500) |
| Border radius | `8px` (cards), `4px` (badges) |
| Card padding | `16px 20px` |
| Grid | 12-col, gap `16px` |

---

## Section Pills

| Sección | Color |
|---------|-------|
| Para JR | `#4f8ef7` (blue) |
| Operaciones | `#eab308` (yellow) |
| Amanda | `#22c55e` (green) |
| Sistema | `#8888a0` (gray) |

---

## Banner (v4)

- **Left:** Foto de Amanda (circular, border `#4f8ef7`) + nombre + status Online · DGX Spark :8000
- **Center:** Título del reporte + ventana exacta `HH:MM ET YYYY-MM-DD → HH:MM ET YYYY-MM-DD` + Refresh
- **Right:** Logo Privé Group (imagen real, fondo negro)

---

## 4 Secciones principales

### SECCIÓN 1 — PARA JR
Weather · Calendar del día · Contadores · TODO personal · Acciones urgentes con siguiente paso + due

### SECCIÓN 2 — OPERACIONES
Deal pipeline por lane · Equipo (Andrea/Cesar/Amanda) · Proyectos con % progreso

### SECCIÓN 3 — AMANDA
Inbox/drafts procesados · Call log · Activity board (Open Tasks 🔴 / Follow-ups 🟡 / Done 🟢)

### SECCIÓN 4 — SISTEMA
Connectors status + latencia · OpenClaw Mac :18789 · Amanda DGX :8000

---

## File References

| File | Purpose |
|------|----------|
| `templates/morning_brief.html` | HTML template completo (Amanda photo + Privé logo + 4 secciones) |
| `docs/AMANDA-REPORTING-PROMPT.md` | Criterio de formato para TODOS los reportes |
| `apps/web/app/morning-brief/page.tsx` | React page component |
| `apps/web/components/morning-brief/` | Section components |
| `apps/web/app/globals.css` | CSS variables shared with Deal Finder |
| `apps/api/src/morning-brief/` | API module |

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| v1.0 | 2026-03-16 | Initial spec — 4 secciones, banner con Amanda + Privé logo, Deal Finder design system |
