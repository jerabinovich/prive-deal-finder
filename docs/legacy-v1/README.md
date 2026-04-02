# Contenido recuperado del repo anterior (commit e7f46f9)

Antes del force-push al repo actual, el remoto tenía una **versión v1** del Deal Finder: app estática en un solo `index.html` desplegada en GitHub Pages, con 8 deals de Miami hardcodeados y documentación de sesión.

Este contenido se recuperó de GitHub (el commit sigue accesible por SHA) para **combinar lo útil** con el producto actual (Next.js + NestJS + Prisma + Cloud Run).

## Archivos en esta carpeta

| Archivo | Descripción |
|---------|-------------|
| **LOG-ACTIVIDAD.md** | Log de sesión: decisiones, 8 deals, features v1, roadmap, links. Útil como contexto de producto y prioridades. |
| **DOCUMENTACION-PRIVE-DEAL-FINDER.md** | Documentación técnica de la v1 (stack, fuentes de datos, hosting, mejoras pendientes). |
| **index-v1.html** | App completa v1 (HTML+CSS+JS en uno). Referencia de UI/UX, estructura de deal cards, filtros, modales, export CSV. |

## Cómo aprovecharlo

1. **Roadmap y prioridades**  
   En LOG-ACTIVIDAD y DOCUMENTACION está el roadmap v1 (Maps, MDPA, Repliers, más deals, dominio custom). Parte ya está hecha en este repo; el resto sirve para priorizar.

2. **Los 8 deals de Miami**  
   Están dentro de `index-v1.html` en el array `deals`. Puedes:
   - Usarlos como referencia de estructura (market, type, score, owner, metrics, risks, lat/lng).
   - Extraerlos a JSON y usarlos como seed en la API/Prisma si quieres datos de ejemplo coherentes con la v1.

3. **UI/UX de la v1**  
   La v1 tenía: sidebar de filtros, pipeline status, deal cards con score badge, modal con owner intelligence, outreach (Email/SMS/WhatsApp), export CSV. Ideas reutilizables en la app Next.js actual.

4. **Commit original en GitHub**  
   `https://github.com/jerabinovich/prive-deal-finder/commit/e7f46f9ba44adc1df8eba4172aaf9bdb05d11c30`  
   Ahí puedes ver el árbol completo y el historial anterior si hace falta.

5. **UI/UX de ambas versiones**  
   La UI/UX de la v1 y de la app actual (Next.js) están documentadas juntas en **`docs/UI-UX-REFERENCE.md`**, para usar ambas como referencia al evolucionar el producto.
