# Morning Brief — Template Spec v1.0
> **Prive Group · Amanda AI · OpenClaw**
> Última actualización: 2026-03-16

Formato canónico del **Morning Brief** — reporte diario de Amanda → Telegram → jr@privegroup.com

---

## Estructura — 9 secciones fijas (en este orden)

| # | Sección | Fuente |
|---|---------|--------|
| 1 | 🔴 Acciones que requieren tu decisión | memory/pending-followups |
| 2 | 🟡 Borradores listos para enviar | Gmail drafts + Amanda queue |
| 3 | 📅 Calendario — decisiones pendientes | Google Calendar (needsAction) |
| 4 | 📆 Calendar forecast — próximos 7 días | Google Calendar todos los eventos |
| 5 | ✅ Todo & reminders | Emails equipo + followups |
| 6 | 🏗 Estado de proyectos | CRM + memory |
| 7 | 📊 Pipeline activo | CRM deals con scores |
| 8 | 📬 Emails equipo Prive urgentes | Gmail @privegroup.com sin leer |
| 9 | ⚠️ Anomalías | Solo si hay algo inusual |

Secciones sin contenido real → **omitir completamente**.

---

## Fuentes de datos — ejecutar TODAS

```
1. GET http://localhost:8000/memory/pending-followups    → acciones y borradores pendientes
2. Gmail jr@privegroup.com (is:unread newer_than:2d)     → emails humanos sin respuesta
3. Gmail from:@privegroup.com is:unread                  → emails equipo urgentes
4. GET http://localhost:8000/crm/deals                   → pipeline activo con scores
5. Google Calendar próximos 7 días                       → todos los eventos
6. Gmail label:AMANDA/OpportunityRE is:unread            → Fast Scans sin leer
```

---

## Sección 1 — 🔴 Acciones que requieren tu decisión

Numeración empieza en 1 y es **secuencial a través de todas las secciones**.

```
N. [Deal/Asunto] — [descripción breve]
   → [contexto]
   Opciones:
   A. [acción A]   B. [acción B]   C. [acción C si aplica]
   ✍️ Respondé: NA / NB / NC
```

---

## Sección 2 — 🟡 Borradores listos para enviar

```
N. [Deal/Destinatario] — [asunto]
   → [resumen del borrador]
   Opciones:
   A. APPROVED SEND   B. HOLD   C. EDIT
   ✍️ Respondé: NA / NB / NC
```

---

## Sección 3 — 📅 Calendario — decisiones pendientes

Solo invites con `myResponseStatus: needsAction`.

```
N. [Nombre evento] — [Día fecha · hora ET]
   → [organizador · N asistentes · contexto]
   Opciones: A. ACCEPT   B. DECLINE   C. TENTATIVE
   ✍️ Respondé: NA / NB / NC
```

---

## Sección 4 — 📆 Calendar forecast — próximos 7 días

Lista **TODOS** los eventos. Incluye aceptados, pendientes, spam detectado.

```
[Día fecha]  [hora ET]  —  [Nombre evento]
[organizador · N asistentes · notas]
badge: accepted | needs action | spam invite
```

Reglas:
- Spam invites → badge "spam invite", sin pedir acción
- Pendientes de respuesta → badge "needs action" + referencia al ítem de sección 3

---

## Sección 5 — ✅ Todo & reminders

```
• [Tarea] — prioridad: alta | media | info
  [Contexto: quién, qué necesita JR]
```

Prioridades:
- **alta** — acción de JR en ≤24h
- **media** — acción esta semana
- **info** — informativo, sin urgencia

---

## Sección 6 — 🏗 Estado de proyectos

```
[Nombre]  [estado: activo | nuevo | bloqueado | en espera]
→ Progreso: [%]
→ Próximo paso: [descripción]
→ Lead: [quién]
```

---

## Sección 7 — 📊 Pipeline activo

```
N.X  [Deal name]  —  [etapa]  —  score [N]  🟢|🟡|🔴
     → [próxima acción]
```

Score: ≥70 🟢 alto · 40–69 🟡 medio · <40 🔴 bajo

---

## Sección 8 — 📬 Emails equipo Prive — urgentes

```
🔴|🟡|🟢  De: [nombre] → [destinatario]
Asunto: [asunto]
→ [resumen 1 línea]
→ Qué necesita JR: [acción]
```

Criterios: 🔴 bloquea a terceros / tiene deadline · 🟡 JR debe revisar antes de que proceda · 🟢 FYI

---

## Sección 9 — ⚠️ Anomalías

Solo si hay algo genuinamente inusual. Omitir si no hay nada.

---

## Footer

```
📥 Inbox humanos: [N]  |  🤖 Auto-scans sin leer: [N]  |  📝 Borradores: [N]  |  📅 Eventos esta semana: [N]
Respondido: 0 / [total items accionables]
```

---

## Comandos de respuesta rápida

| Comando | Acción |
|---------|--------|
| `1A` / `2B` / `3C` | Opción A/B/C del item N |
| `APPROVED N` | Aprobar item N |
| `HOLD N` | Pausar item N |
| `EDIT N` | Revisar borrador N |
| `STATUS` | Update del pipeline |
| `RUN [nombre]` | Ejecutar cron manualmente |

---

## Reglas absolutas

1. Numeración **secuencial** a través de TODAS las secciones — nunca reinicia
2. **NUNCA** URLs, puertos, IDs técnicos, UUIDs, status de containers
3. **NUNCA** status del sistema (DB, API health, container status)
4. Secciones vacías → **omitir completamente**
5. Spam invites → marcar, no pedir acción
6. Sección 1 (decisiones JR) siempre al tope
7. Enviar vía Telegram `8396621413`

---

## Cron config (OpenClaw)

```
Name:     Morning Brief
Schedule: 30 6 * * * America/New_York   (6:30 AM ET, diario)
Agent:    main
Delivery: announce (last) → telegram:8396621413
Timeout:  120s
```

---

## UI / Componente web

El brief también se renderiza en `apps/web/app/brief/` dentro de prive-deal-finder.
Design system: `docs/UI-UX-REFERENCE.md` · Componente: `docs/MORNING-BRIEF-UI-SPEC.md`

---

## Changelog

| Versión | Fecha | Cambios |
|---------|-------|---------|
| v1.0 | 2026-03-16 | Template inicial — 9 secciones, A/B/C, calendar forecast 7d, todo, proyectos, emails urgentes |
