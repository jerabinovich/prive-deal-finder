# Morning Brief — Template v2.0
Prive Group · Amanda AI · OpenClaw
Última actualización: 2026-03-17

Formato canónico del Morning Brief — aplica a TODOS los reportes de Amanda (diario, email triage, pipeline, llamadas, on-demand).

---

## Encabezado — siempre primero

```
REPORTE [TIPO] (ET) — [FECHA] — Operaciones
Período: [HH:MM ET YYYY-MM-DD] → [HH:MM ET YYYY-MM-DD]
```

---

## SECCIÓN 1 — 🔵 PARA JR
> Todo lo que requiere atención, decisión o acción directa de JR. Siempre al tope.

### 1a. Contadores rápidos
• Correos nuevos: [N] | Borradores Amanda: [N] | Acciones urgentes: [N] | Reuniones hoy: [N] / mañana: [N]

### 1b. Acciones urgentes (hoy / próximas 48h)
Numeración secuencial. Cada item:
```
N. [Deal / Asunto] — [descripción breve]
   → Acción realizada: [qué hizo Amanda]
   → Siguiente paso para JR: [acción concreta]
   → Due: [hoy | 24h | 48h | fecha]
   → Status: 🔴 URGENTE | 🟡 EN PROCESO | 🟢 ON TRACK
   Opciones: A. [acción A]  B. [acción B]  C. [acción C]
   ✍️ Respondé: NA / NB / NC
```

### 1c. Borradores listos para enviar
```
N. [Destinatario] — [Asunto]
   → Resumen: [1 línea]
   Opciones: A. APPROVED SEND  B. HOLD  C. EDIT
   ✍️ Respondé: NA / NB / NC
```

### 1d. Calendar — decisiones pendientes (needsAction)
```
N. [Nombre evento] — [Día fecha · hora ET]
   → [organizador · N asistentes · contexto]
   Opciones: A. ACCEPT  B. DECLINE  C. TENTATIVE
   ✍️ Respondé: NA / NB / NC
```

### 1e. Calendar forecast — próximos 7 días
```
[Día fecha]  [hora ET] — [Nombre evento]  [badge: accepted | needs action | spam invite]
```

### 1f. TODO & reminders
```
• [Tarea] — prioridad: alta | media | info
  [Contexto: quién, qué necesita JR]
```

---

## SECCIÓN 2 — 🟡 OPERACIONES
> Estado del negocio, deals y equipo.

### 2a. Pipeline activo
```
N.X [Deal name] — [etapa] — score [N] 🟢|🟡|🔴
   → [próxima acción]
```
Score: ≥70 🟢 alto · 40–69 🟡 medio · <40 🔴 bajo
Lanes: DISTRESS_OWNER | AUCTION_MONITOR | OFF_MARKET_STANDARD | RESEARCH_REQUIRED | NON_ACQUIRABLE_NOISE

### 2b. Estado de proyectos
```
[Nombre]  [activo | nuevo | bloqueado | en espera]
→ Progreso: [%]
→ Próximo paso: [descripción]
→ Lead: [quién]
```

### 2c. Equipo
```
👤 Andrea   — [tarea activa] → Due: [plazo]
👤 Cesar    — [tarea activa] → Due: [plazo]
🤖 Amanda   — Emails procesados: [N] | Llamadas: [N]
```

### 2d. Emails equipo Prive — urgentes
```
🔴|🟡|🟢 De: [nombre] → [destinatario]
Asunto: [asunto]
→ [resumen 1 línea]
→ Qué necesita JR: [acción]
```
🔴 bloquea terceros / tiene deadline · 🟡 JR debe revisar antes de que proceda · 🟢 FYI

---

## SECCIÓN 3 — 🤖 AMANDA
> Actividad del agente en la ventana del reporte.

### 3a. Inbox procesado
```
• [remitente] · [asunto] · [DRAFT_REPLY | REVIEW | FYI | ARCHIVED]
```

### 3b. Call log
```
Recibidas: [N] | Realizadas: [N] | Perdidas: [N]
• [↗|↙|✕] [Nombre] · [número] · [duración] · [hora ET]
```

### 3c. Activity board
```
🔴 Open Tasks: [N]     — [descripción top items]
🟡 Follow-ups: [N]     — esperando respuesta
🟢 Done/Reminders: [N] — completadas en ventana
```

---

## SECCIÓN 4 — ⚪ SISTEMA
> Solo si hay anomalías o alertas. Omitir si todo normal.

### 4a. Conectores
```
Gmail [OK|WARN|ERR] · Calendar [OK|WARN|ERR] · OpenClaw :18789 [OK|WARN|ERR]
Amanda/DGX :8000 [OK|WARN|ERR] · Notion [OK|WARN|ERR] · GitHub [OK|WARN|ERR]
```

### 4b. Anomalías
Solo si hay algo genuinamente inusual. Omitir si no hay nada.

---

## Footer — siempre al final
```
📥 Inbox humanos: [N] | 🤖 Auto-scans sin leer: [N] | 📝 Borradores: [N] | 📅 Eventos esta semana: [N]
Respondido: 0 / [total items accionables]
```

---

## Comandos de respuesta rápida
| Comando | Acción |
|---------|---------|
| 1A / 2B / 3C | Opción A/B/C del item N |
| APPROVED N | Aprobar item N |
| HOLD N | Pausar item N |
| EDIT N | Revisar borrador N |
| STATUS | Update del pipeline |
| RUN [nombre] | Ejecutar cron manualmente |

---

## Fuentes de datos — ejecutar TODAS
1. `GET http://localhost:8000/memory/pending-followups` → acciones y borradores pendientes
2. Gmail jr@privegroup.com `(is:unread newer_than:2d)` → emails humanos sin respuesta
3. Gmail `from:@privegroup.com is:unread` → emails equipo urgentes
4. `GET http://localhost:8000/crm/deals` → pipeline activo con scores
5. Google Calendar próximos 7 días → todos los eventos
6. Gmail `label:AMANDA/OpportunityRE is:unread` → Fast Scans sin leer
7. Amanda call log (si disponible) → llamadas recibidas/realizadas/perdidas

---

## Reglas absolutas
1. Numeración secuencial a través de TODAS las secciones — nunca reinicia
2. NUNCA URLs, puertos, IDs técnicos, UUIDs, status de containers en el output
3. Secciones sin contenido real → omitir completamente
4. Spam invites → marcar, no pedir acción
5. Sección 1 (decisiones JR) siempre al tope
6. Si no hay datos para un campo: `Sin datos suficientes` — nunca omitir sin avisar
7. Máximo 2 líneas por item. Bullets cortos, no párrafos.
8. Delivery: Telegram 8396621413

---

## Cron config (OpenClaw)
```
Name: Morning Brief
Schedule: 30 6 * * * America/New_York  (6:30 AM ET, diario)
Agent: main
Delivery: announce (last) → telegram:8396621413
Timeout: 120s
```

---

## Changelog
| Versión | Fecha | Cambios |
|---------|-------|---------|
| v2.0 | 2026-03-17 | Restructura en 4 secciones: Para JR / Operaciones / Amanda / Sistema |
| v1.0 | 2026-03-16 | Template inicial — 9 secciones, A/B/C, calendar forecast 7d |
