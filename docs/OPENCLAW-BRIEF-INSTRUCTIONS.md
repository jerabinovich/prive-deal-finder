# INSTRUCCIONES PARA OPENCLAW — Sistema de Reportes HTML
**Versión:** v1.0  
**Fecha:** 2026-03-19  
**Aplica a:** Amanda AI · brain-ai-prive · OpenClaw Gateway

---

## QUÉ ES ESTE SISTEMA

Amanda genera dos reportes diarios para JR (Javier Rabinovich) en tres formatos simultáneos:

| Canal | Formato | Cuándo llega |
|-------|---------|-------------|
| Telegram `8396621413` | Texto plano con emojis | Inmediato al generarse |
| Email `jr@privegroup.com` | HTML oscuro con diseño Privé | Inmediato al generarse |
| `brief.privegroup.com` | HTML oscuro (mismo diseño) | Siempre disponible — se actualiza con cada brief |

---

## HORARIOS DE LOS BRIEFS

| Nombre | Cron | Timezone | Tipo |
|--------|------|----------|---------|
| Morning Brief | `30 6 * * *` | America/New_York | `morning` |
| Afternoon Brief | `30 16 * * *` | America/New_York | `afternoon` |

---

## ESTRUCTURA OBLIGATORIA — 4 SECCIONES

TODOS los reportes deben seguir esta estructura en este orden exacto.
No cambiar el orden. No inventar secciones nuevas.

```
REPORTE [TIPO] (ET) — [FECHA] — Operaciones
Período: [HH:MM ET YYYY-MM-DD] → [HH:MM ET YYYY-MM-DD]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔵 SECCIÓN 1 — PARA JR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Contadores, acciones urgentes, borradores, calendario, TODO]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🟡 SECCIÓN 2 — OPERACIONES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Pipeline por lane, equipo, proyectos]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🟢 SECCIÓN 3 — AMANDA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Inbox procesado, call log, activity board]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚫ SECCIÓN 4 — SISTEMA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[Status conectores — solo si hay anomalías]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📥 Inbox: [N] | 📝 Borradores: [N] | 📅 Eventos: [N]
Respondido: 0/[N]
```

---

## DISEÑO VISUAL (HTML)

Template HTML de referencia: `templates/morning_brief.html` (repo `prive-deal-finder`)

| Token | Valor |
|-------|-------|
| Background | `#0a0a0f` |
| Cards | `#111118` |
| Borders | `#2a2a35` |
| Font | JetBrains Mono |
| Para JR pill | `#4f8ef7` azul |
| Operaciones pill | `#eab308` amarillo |
| Amanda pill | `#22c55e` verde |
| Sistema pill | `#8888a0` gris |

Banner: Amanda photo (izquierda) + título + período (centro) + Logo Privé fondo negro (derecha)

---

## ENTREGA POR EMAIL

Script en DGX: `brain_ai_prive/scripts/send_brief_email.py`

Llamar DESPUÉS del send de Telegram (no en lugar de):
```python
import subprocess
try:
    subprocess.run(["python3",
        "/home/privegroup/spark-dev-workspace/brain_ai_prive/scripts/send_brief_email.py",
        "--content", brief_content, "--type", brief_type],
        check=True, timeout=30)
except Exception as e:
    print(f"[WARN] Email falló (Telegram OK): {e}")
```

---

## ENDPOINT WEB

- FastAPI local: `GET http://localhost:8000/brief`
- URL pública: `https://brief.privegroup.com` (Cloudflare Access, login jr@privegroup.com)
- Se actualiza con cada brief generado
- Amanda guarda en: `brain_ai_prive/output/latest_brief.html`

### Pipeline report multi-canal (API Nest)

- JSON: `GET /api/reports/pipeline`
- CSV: `GET /api/reports/pipeline.csv`
- PDF: `GET /api/reports/pipeline.pdf`
- Telegram texto: `GET /api/reports/pipeline.telegram`
- Markdown: `GET /api/reports/pipeline.md`
- HTML: `GET /api/reports/pipeline.html`
- Bundle para integraciones: `GET /api/reports/pipeline.channels` (incluye `telegram`, `markdown`, `html` en una sola respuesta)

### Sender operativo (Telegram + otros canales)

Script: `scripts/send_pipeline_report.js`

Variables:
- `API_BASE` (ej: `http://127.0.0.1:3001/api`)
- `API_BEARER_TOKEN` (si API está protegida)
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Uso:
- Telegram: `npm run reports:pipeline:send`
- Markdown (stdout): `npm run reports:pipeline:send -- --mode=markdown`
- HTML (stdout): `npm run reports:pipeline:send -- --mode=html`
- JSON bundle (stdout): `npm run reports:pipeline:send -- --mode=json`

---

## CONTEXTO MORNING vs AFTERNOON

**Morning** (06:30 ET): ventana 24h — decisiones del día, reuniones HOY y MAÑANA, pipeline urgente
**Afternoon** (16:30 ET): ventana 10h desde morning — qué cambió, borradores antes del cierre, prep mañana

---

## REGLAS ABSOLUTAS

1. Numeración secuencial a través de todas las secciones — nunca reinicia
2. NUNCA incluir URLs internas, puertos, IDs técnicos, UUIDs, status de containers
3. Secciones vacías → omitir completamente
4. Sección 1 (Para JR) siempre al tope
5. Sin datos → escribir `Sin datos suficientes`
6. Máximo 2 líneas por item
7. Entrega: Telegram `8396621413` + Email `jr@privegroup.com` + disco para web

---

## MODELO AI ACTIVO

- Motor: Ollama (DGX Spark) — `http://localhost:11434`
- Modelo: `llama3.1:8b` ✔ soporta tools
- Descartados: `glm4:9b-chat-q8_0` (no soporta tools) · `qwen2.5:7b` (no servía)

---

## ARCHIVOS EN EL REPO (prive-deal-finder)

| Archivo | Ubicación | Para qué |
|---------|-----------|----------|
| `morning_brief.html` | `templates/` | Template HTML completo |
| `MORNING-BRIEF-TEMPLATE.md` | `docs/` | Estructura contenido v2.0 |
| `MORNING-BRIEF-UI-SPEC.md` | `docs/` | Design system + tokens |
| `AMANDA-REPORTING-PROMPT.md` | `docs/` | Criterio formato todos los reportes |
| `OPENCLAW-BRIEF-INSTRUCTIONS.md` | `docs/` | Este archivo — instrucciones para OpenClaw |
| `CLOUDFLARE-TUNNEL-SETUP.md` | `docs/` | Setup brief.privegroup.com |
| `send_brief_email.py` | `brain_ai_prive/scripts/` | Script email HTML |

---
*Repo: prive-deal-finder · 2026-03-19*
