# TODO SOBRE PRIVE DEAL FINDER
## Documentacion Completa de Contexto e Instrucciones
**Ultima actualizacion:** Marzo 15, 2026 | **Autor:** Prive Group

---

## 1. QUE ES ESTA APP Y DE DONDE SE NUTRE LA INFORMACION

### Descripcion
Prive Deal Finder es una aplicacion web estatica (single-page app) disenada como herramienta interna de Prive Group para originar Joint Ventures (JV) en el mercado inmobiliario comercial de Miami-Dade.

### Fuentes de Datos Actuales
EN LA VERSION ACTUAL (v1.0), los datos son **ESTATICOS y manuales**:
- Los deals estan hardcodeados directamente en el archivo `index.html` como un array de JavaScript
- No hay conexion a ninguna base de datos externa en tiempo real
- Los datos de propietarios, metricas y pain points son datos de prueba/ejemplo

### Fuentes de Datos PLANIFICADAS (roadmap)
| Fuente | Tipo | Status | Uso |
|--------|------|--------|-----|
| Miami-Dade Property Appraiser | API Publica | Pendiente | Datos de folio, propietario, valor tasado |
| CoStar API | API Comercial | Pendiente | Rentas de mercado, vacancia, comps |
| Public Records / Clerk | Web Scraping | Pendiente | Foreclosures, lis pendens, cambios de titulo |
| Google Maps API | API Gratuita (con key) | Pendiente | Mapas, Street View, geocoding |
| Repliers.com | API Comercial | Pendiente | Outreach automation, email tracking |
| Lender Database | API Interna | Q2 2026 | Terminos de deuda, lenders activos |

---

## 2. ARCHIVOS EN EL REPOSITORIO (v1)

### Estructura del repo anterior
```
prive-deal-finder/
  README.md
  index.html                         <- APP COMPLETA (HTML + CSS + JS todo en uno)
  DOCUMENTACION-PRIVE-DEAL-FINDER.md <- ESTE ARCHIVO
  LOG-ACTIVIDAD.md
```

---

## 3. STACK TECNICO v1

```
Frontend:    HTML5 + CSS3 + JavaScript ES6+ (Vanilla)
Icons:       Font Awesome 6.4.0 (CDN)
Hosting:     GitHub Pages (jerabinovich.github.io)
Datos:       Array estatico en index.html
Modales:     JavaScript DOM manipulation
Export:      Blob API + URL.createObjectURL (CSV)
Clipboard:   navigator.clipboard API
Maps:        Google Maps Embed API (pendiente key)
```

---

## 4. ROADMAP DE MEJORAS PENDIENTES (v1)

- Google Maps API - Mapa Interactivo
- Miami-Dade Property Appraiser API
- Repliers.com - Outreach Automation
- Mas deals en pipeline
- Dominio custom (deals.privegroup.com)
- Backend real (Node.js + PostgreSQL)
- Auth/login
- LLM integration para deal scoring

---

*Este documento corresponde a la version v1 (single-page, GitHub Pages). El repo actual ya tiene backend NestJS, Next.js, Prisma, integraciones MDPA/Broward/Palm Beach, Cloud Run y auth. Se conserva aqui como referencia y para combinar lo mejor de ambas versiones.*
