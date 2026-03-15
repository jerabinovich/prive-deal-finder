# Prive Deal Finder - Arquitectura de Plataforma

Ultima actualizacion: 2026-02-06

## 1. Vision general

Prive Deal Finder es una plataforma interna para originacion de JVs y oportunidades off-market que unifica datos de propiedad, mercado, deuda y propietarios en un solo "Deal OS". El objetivo es identificar pain points accionables, priorizar oportunidades y estructurar JVs inteligentes con trazabilidad de datos.

Capas principales:
- Frontend web (Deal Console)
- Backend API (Deal Engine)
- Data Layer (OLTP + Data Lake/OLAP + Staging)
- Integraciones externas (APIs y portales oficiales)
- Analytics, scoring y reporting

## 2. Alcance y no alcance

Alcance:
- Cobertura geografica: Miami-Dade, Broward y Palm Beach.
- Integracion con fuentes oficiales y agregadores comerciales con acceso documentado.
- Orquestacion de deals, scoring, outreach y reporting.

No alcance:
- Scraping no autorizado o violaciones de terminos de uso.
- Acceso a datasets restringidos sin contrato vigente.
- Funcionalidad de CRM completo para terceros (uso interno).

## 3. Arquitectura de alto nivel

- Deal Console (frontend) consume la API del Deal Engine.
- Deal Engine orquesta la logica de negocio y las integraciones.
- IntegrationsModule ingiere datos externos en staging, normaliza y actualiza entidades.
- Data Lake/OLAP soporta analytics avanzados y modelos de scoring.

## 4. Frontend (Deal Console)

Objetivo: UI donde el equipo ve el pipeline, filtra, prioriza y ejecuta outreach.

- Framework: React + Next.js
- Lenguaje: TypeScript
- Estilos: Tailwind CSS + componentes propios (cards, tags, modals, badges)
- State management: React Query/TanStack Query + Zustand/Context para estado de UI
- Autenticacion: JWT + HttpOnly cookies, con soporte a SSO corporativo

Rutas clave:
- `/login`
- `/deals`
- `/deals/:id`
- `/reports`
- `/settings/integrations`

Funciones UI principales:
- Filtros por mercado, asset type, size, cap rate, score, pain points.
- Visualizacion de Deal Score, metricas clave y tags.
- Modales de detalle, outreach y reportes.
- Export CSV/JSON via backend.
- Panel de Data Pipeline Status con estado de integraciones.

## 5. Backend (Deal Engine API)

Objetivo: orquestar deals, logica de negocio, scoring y conexion a fuentes externas.

- Framework: Node.js + NestJS
- Lenguaje: TypeScript
- Arquitectura: Clean/Hexagonal
- Autenticacion: JWT + refresh tokens, roles (admin, analyst, partner)

Modulos principales:

### 5.1 DealsModule
- CRUD de deals
- Calculo y actualizacion de Deal Score
- Endpoints:
  - `GET /deals`
  - `GET /deals/:id`
  - `POST /deals`
  - `PATCH /deals/:id`
  - `GET /deals/:id/export` (JSON/CSV)

### 5.2 OwnersModule
- Datos de propietarios, entidades legales, contactos
- Endpoints:
  - `GET /owners/:id`
  - `GET /owners?search=...`

### 5.3 OutreachModule
- Generacion de templates (email/SMS/notes)
- Registro de interacciones
- Endpoints:
  - `POST /deals/:id/outreach/email-template`
  - `POST /deals/:id/outreach/sms-template`
  - `POST /deals/:id/outreach/log`

### 5.4 ReportsModule
- Executive summaries, top deals, breakdowns de mercado
- Generacion de PDFs
- Endpoints:
  - `GET /reports/pipeline?filters=...`
  - `GET /reports/pipeline.pdf?filters=...`

### 5.5 IntegrationsModule
- Adaptadores a fuentes externas (ver seccion 7)
- Jobs de sync/ETL
- Endpoints internos:
  - `POST /integrations/:source/sync`
  - `GET /integrations/status`

### 5.6 AuthModule
- Login, refresh tokens, control de permisos por rol
- Opcional: SSO con Google Workspace

## 6. Capa de datos

### 6.1 Base de datos transaccional (OLTP)

Motor: PostgreSQL

Tablas clave:
- `deals`
- `deal_metrics`
- `deal_pain_points`
- `owners`
- `outreach_logs`
- `users`
- `integrations`
- `markets`
- `lenders`
- `stg_*` (staging por fuente)
- `raw_*` (snapshots crudos por fuente)

### 6.2 Data Lake / Warehouse (OLAP)

Motor sugerido: BigQuery, Snowflake o Redshift

Uso:
- Historicos de valoracion, rent rolls, comps, market data
- Dashboards avanzados (Looker, Metabase, Power BI)
- Modelos de scoring/ML

### 6.3 Caching

Redis para:
- Consultas frecuentes de deals
- Panel de integraciones
- Throttling y rate limiting

## 7. IntegrationsModule (diseno y conectores)

Contrato comun de conectores:

```ts
interface IntegrationConnector {
  source: string;
  sync(): Promise<SyncResult>;
  getHealthStatus(): Promise<HealthStatus>;
}
```

Flujo de ingest:
1. Ingesta a `stg_*` (staging)
2. Normalizacion y enriquecimiento
3. Resolucion de entidades (parcel/folio/APN, owners)
4. Upsert en `deals`, `deal_metrics`, `deal_pain_points`, `owners`

Estrategia de ejecucion:
- Sync completo inicial + sync incremental posterior
- Manejo de errores por conector con reintentos y backoff
- Observabilidad por conector (latencia, errores, freshness)
- Conectores con costo (ej. MDPA BBS) requieren confirmacion explicita antes de ejecutar sync.

Conectores (status):
- MiamiDadeAppraiserConnector (EXISTENTE)
- MiamiDadeParcelsConnector (EXISTENTE)
- BrowardParcelsConnector (EXISTENTE)
- PalmBeachParcelsConnector (EXISTENTE)
- LenderDatabaseConnector (PLANIFICADO - Q2 2026)
- CoStarConnector (CANDIDATO - requiere licencia comercial)
- PublicRecordsConnector (CANDIDATO - acceso oficial pendiente)
- LoopNetConnector (CANDIDATO)
- CREXiConnector (CANDIDATO)
- ZillowConnector (CANDIDATO)
- GmailConnector (CANDIDATO)
- TwilioConnector (CANDIDATO)
- DocuSignConnector (CANDIDATO)

## 8. Gobernanza y calidad de datos

- Lineage: cada dato conserva `source`, `source_record_id` y `ingested_at`.
- Normalizacion de direcciones: estandarizacion USPS/UTF8 safe y geocoding.
- Resolucion de entidades:
  - Parcel/folio/APN como clave primaria geografica.
  - Owners vinculados por EIN/LLC, nombres normalizados y direcciones.
- Deduplicacion:
  - Regla por `parcel_id + owner_id`.
  - Merge por fuzzy matching con thresholds configurables.
- Controles de calidad:
  - Freshness por fuente.
  - Validacion de rangos (cap rate, NOI, area).
  - Alertas por outliers.

## 9. Seguridad y compliance

- RBAC por rol y principio de menor privilegio.
- Auditoria de accesos y cambios de deal.
- Cifrado en transito (TLS) y en reposo (KMS).
- PII: minimizacion, masking en logs, y segregacion por tablas.
- Retencion y borrado segun politica interna y licencias.
- Cumplimiento estricto de terminos de uso y licencias de proveedores.

## 10. Analytics y scoring

`ScoringService`:
- Inputs: metricas financieras, data de mercado, pain points, edad del asset, riesgo de deuda, liquidez.
- Output: `deal_score` (0-100) + tags de riesgo/oportunidad.
- Dependencias: fuentes de propiedad, mercado, deuda y macroeconomia.
- Cadencia recomendada: recalculo diario o ante cambios materiales.

Dashboards:
- Concentracion por mercado y tipo de activo.
- Progreso de pipeline (nuevo -> DD -> negociacion -> cerrado).
- Performance por origen (CoStar, direct owner, brokers).

## 11. Observabilidad

- Monitoreo de pipelines y jobs (latencia, errores, backlog).
- APM y trazas de API.
- Alertas por degradacion de fuentes externas.

## 12. Infraestructura y DevOps

- Cloud: AWS (referencial)
- Frontend: Next.js en Vercel o S3 + CloudFront
- Backend: NestJS en ECS Fargate/EKS o Lambda (API Gateway)
- DB: Aurora PostgreSQL
- Cache: ElastiCache (Redis)
- Storage: S3 para PDFs, exports y anexos
- CI/CD: GitHub Actions o GitLab CI
- Observabilidad: logs centralizados, APM, alertas de integraciones

## 13. Catalogo operativo de APIs e integraciones

Campos:
- Proveedor, Categoria, Cobertura, Datos clave, Metodo de acceso, Autenticacion, Cadencia, Modelo comercial, Notas de licencia/uso, Estado

Estados:
- EXISTENTE, PLANIFICADO, CANDIDATO

### 13.1 Propiedad y catastro (Assessor / Tax Roll / Parcels)

| Proveedor | Categoria | Cobertura | Datos clave | Metodo de acceso | Autenticacion | Cadencia | Modelo comercial | Notas de licencia/uso | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Miami-Dade Property Appraiser (MDPA) | Assessor/Tax Roll | Miami-Dade | Parcel, owner, assessed value, land/building | Bulk data files (portal) | Cuenta + creditos | Semanal (segun portal) | Pago por archivo | Ref: https://bbs.miamidade.gov/ (bulk data files; CSV semanal) | EXISTENTE |
| Miami-Dade Property Appraiser (MDPA) | Public records request | Miami-Dade | Registros y datasets bajo solicitud | Solicitud formal | N/A | Segun aprobacion | Publico | Ref: https://www.miamidade.gov/pa/public-records-request.asp | CANDIDATO |
| Broward County Property Appraiser (BCPA) | Assessor/Parcels | Broward | Parcel data, owner, assessed value | Solicitud directa (public records/GIS) | N/A | Variable | Pago / segun solicitud | Ref: https://browardcountypropertyappraiser.org/contact-us/ | CANDIDATO |
| Palm Beach County Property Appraiser (PBCPPA) | Assessor/Tax Roll | Palm Beach | CAMA, parcel, owner, assessed value | Flat files (Public Services) | N/A | Semestral (Ago/Nov) | Publico | Ref: https://pbcpao.gov/departments/public_services.htm | CANDIDATO |
| ATTOM Data API | Property data | USA | Parcel, deeds, AVM, tax | API REST | API key (header) | On-demand | Subscription | Ref: https://api.developer.attomdata.com/docs (API key requerido) | CANDIDATO |
| Estated API | Property data | USA | Property facts, owner, valuation | API REST | API key | On-demand | Subscription | Ref: https://estated.com/developers/docs/v4 (API key requerido) | CANDIDATO |
| Regrid Parcels API | Parcels | USA | Parcel boundaries + attributes | API REST | Token (parametro) | On-demand | Subscription | Ref: https://support.regrid.com/api/using-the-parcel-api (token requerido; rate limits) | CANDIDATO |

### 13.2 Registros oficiales (Clerk/Recorder)

| Proveedor | Categoria | Cobertura | Datos clave | Metodo de acceso | Autenticacion | Cadencia | Modelo comercial | Notas de licencia/uso | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Miami-Dade Clerk of Courts | Official records | Miami-Dade | Deeds, mortgages, lis pendens | Portal oficial | N/A | Segun publicacion | Publico | Ref: https://www.miamidadeclerk.gov/clerk/records-library.page (sin feed automatizado en MVP) | CANDIDATO |
| Broward County Official Records | Official records | Broward | Deeds, mortgages, liens | Portal oficial | N/A | Segun publicacion | Publico | Ref: https://www.broward.org/RecordsTaxesTreasury/Pages/OfficialRecordsSearch.aspx | CANDIDATO |
| Palm Beach Clerk & Comptroller | Official records | Palm Beach | Official records | Portal oficial + FTP (suscripcion) | Cuenta/FTP | Segun publicacion | Publico + suscripcion | Ref: https://www.mypalmbeachclerk.com/records/official-records | CANDIDATO |

### 13.3 GIS, parcel mapping y geocoding

| Proveedor | Categoria | Cobertura | Datos clave | Metodo de acceso | Autenticacion | Cadencia | Modelo comercial | Notas de licencia/uso | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Miami-Dade Open Data Hub | GIS/Open Data | Miami-Dade | Parcels, permits, zoning, code enforcement, etc. | API REST (ArcGIS Hub) | N/A | Variable | Publico | Ref: https://opendata.miamidade.gov/ | CANDIDATO |
| Broward County GeoHub | GIS/Open Data | Broward | GIS layers (parcel data via BCPA fee) | API REST (ArcGIS Hub) | N/A | Variable | Publico | Ref: https://www.broward.org/Planning/Pages/GIS.aspx | CANDIDATO |
| Palm Beach County Open Data | GIS/Open Data | Palm Beach | GIS layers y datasets | API REST (ArcGIS Hub) | N/A | Variable | Publico | Ref: https://opendata2-pbcgov.opendata.arcgis.com/ | CANDIDATO |
| Palm Beach County Property Appraiser GIS | Parcel base map | Palm Beach | Parcel base map y capas GIS | API REST (ArcGIS Hub) | N/A | Variable | Publico | Ref: https://pbcpao.gov/departments/gis.htm | CANDIDATO |
| City of Miami GIS Services | GIS/Mapping | City of Miami | MapServer/FeatureServer | API REST (ArcGIS Services) | N/A | Variable | Publico | Ref: https://gismaps.miamigov.com/arcgis/rest/services | CANDIDATO |
| Google Maps Geocoding API | Geocoding | Global | Geocoding, place details | API REST | API key (o OAuth 2.0) | On-demand | Pay-as-you-go | Ref: https://developers.google.com/maps/documentation/geocoding/get-api-key | CANDIDATO |
| Mapbox Geocoding API | Geocoding | Global | Geocoding, reverse geocoding | API REST | Access token | On-demand | Usage-based | Ref: https://docs.mapbox.com/api/search/geocoding/ | CANDIDATO |
| Esri Geocoding API | Geocoding | Global | Geocoding y reverse | API REST | API key / OAuth 2.0 | On-demand | Usage-based | Ref: https://developers.arcgis.com/documentation/security-and-authentication/ | CANDIDATO |

### 13.4 Zoning, permitting y code enforcement

| Proveedor | Categoria | Cobertura | Datos clave | Metodo de acceso | Autenticacion | Cadencia | Modelo comercial | Notas de licencia/uso | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Miami-Dade Open Data Hub | Zoning/Permits/Code | Miami-Dade | Permits, zoning, violations | API REST (ArcGIS Hub) | N/A | Variable | Publico | Ref: https://opendata.miamidade.gov/ | CANDIDATO |
| Broward County GeoHub | Zoning/Permits/Code | Broward | Land use, zoning, permits | API REST (ArcGIS Hub) | N/A | Variable | Publico | Ref: https://geohub-bcgis.opendata.arcgis.com/ | CANDIDATO |
| Palm Beach County Open Data | Zoning/Permits/Code | Palm Beach | Zoning, permits, enforcement | API REST (ArcGIS Hub) | N/A | Variable | Publico | Ref: https://opendata2-pbcgov.opendata.arcgis.com/ | CANDIDATO |
| City of Miami Zoning Map | Zoning | City of Miami | Zoning map y capas | Portal GIS / Open Data | N/A | Variable | Publico | Ref: https://www.miami.gov/Your-Government/Innovation-Technology/Open-Data/Data-Explorer | CANDIDATO |
| Palm Beach PZB Maps/GIS | Zoning/GIS | Palm Beach | Mapas y GIS PZB | Portal GIS / descarga | N/A | Variable | Publico | Ref: https://pbcgov.org/pzb/maps/ | CANDIDATO |

### 13.5 Impuestos y liens

| Proveedor | Categoria | Cobertura | Datos clave | Metodo de acceso | Autenticacion | Cadencia | Modelo comercial | Notas de licencia/uso | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Miami-Dade Tax Collector | Taxes | Miami-Dade | Tax payments, delinquency info | Portal oficial | N/A | Variable | Publico | Ref: https://mdctaxcollector.gov/real-estate-tax-payments/ | CANDIDATO |
| Broward County Revenue Collection | Taxes | Broward | Tax bills, payments | Portal oficial / solicitud | N/A | Variable | Publico | Ref: https://browardtax.org/public-records-request | CANDIDATO |
| Palm Beach County Tax Collector | Taxes | Palm Beach | Tax bills, payments | Portal oficial / solicitud | N/A | Variable | Publico | Ref: https://pbctax.gov/public-record-requests | CANDIDATO |

### 13.6 Riesgos y hazards

| Proveedor | Categoria | Cobertura | Datos clave | Metodo de acceso | Autenticacion | Cadencia | Modelo comercial | Notas de licencia/uso | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FEMA NFHL | Flood hazard | USA | Flood zones, maps | API REST (GIS services) | N/A | Mensual | Publico | Ref: https://www.fema.gov/flood-maps/national-flood-hazard-layer | CANDIDATO |
| NOAA CO-OPS Tides & Currents API | Coastal risk | USA | Water levels, tides, currents | API REST (CO-OPS) | N/A | Variable | Publico | Ref: https://tidesandcurrents.noaa.gov/api/ | CANDIDATO |

### 13.7 Mercado, listings y comps

| Proveedor | Categoria | Cobertura | Datos clave | Metodo de acceso | Autenticacion | Cadencia | Modelo comercial | Notas de licencia/uso | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CoStar | CRE market data | USA | Rents, vacancy, comps, pipeline | Contrato/licencia | N/A | Segun contrato | Commercial | Ref: https://www.costar.com/CoStarTerms-and-Conditions (requiere contrato activo) | CANDIDATO |
| RESO Web API (MLS) | MLS data standard | USA | Listings y fields MLS | OData 4.x sobre HTTPS | OAuth 2.0 (Bearer/Client Credentials) | Near real-time | Membership/fees | Ref: https://transport.reso.org/proposals/web-api-core.html | CANDIDATO |
| SimplyRETS | MLS API aggregator | USA | Listings MLS via RESO | API REST | Basic (api_key:api_secret) | Near real-time | Subscription | Ref: https://simplyrets.com/ (Basic auth; requiere credenciales MLS) | CANDIDATO |
| Zillow Group Performance Reporting API | Advertising/performance | USA | Reporting y performance (Zillow Group sites) | API REST (request access) | OAuth 1.0 | Nightly (2-day lag) | Commercial | Ref: https://www.zillowgroup.com/developers/api/mls-broker-data/performance-reporting/ | CANDIDATO |
| Zillow Research Data | Research datasets | USA | ZHVI, rentals, market stats | Descarga CSV | N/A | Periodico | Publico | Ref: https://www.zillow.com/research/data/ | CANDIDATO |
| LoopNet | Listings marketplace | USA | Listings on-market | Contrato/licencia | N/A | Segun acuerdo | Commercial | Ref: https://api.loopnet.com/ (acceso con login; sin API publica documentada) | CANDIDATO |
| CREXi | Listings marketplace | USA | Listings on-market | API (partner/contrato) | Token (segun acuerdo) | Segun acuerdo | Commercial | Ref: https://api.crexi.com/docs/ (API overview; acceso por contacto) | CANDIDATO |

### 13.8 Deuda y financiamiento

| Proveedor | Categoria | Cobertura | Datos clave | Metodo de acceso | Autenticacion | Cadencia | Modelo comercial | Notas de licencia/uso | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| FRED API | Rates/macro | USA | Rates, yield data | API REST | API key | Daily | Publico | Ref: https://fred.stlouisfed.org/docs/api/fred/ | CANDIDATO |
| U.S. Treasury Fiscal Data API | Treasury rates | USA | Yield curve, auctions | API REST | N/A | Daily | Publico | Ref: https://fiscaldata.treasury.gov/api-documentation/ | CANDIDATO |
| Lender Database (internal) | Lenders catalog | USA | Lenders, terms, appetite | Internal DB | N/A | Manual/periodico | Interno | Planificado Q2 2026 | PLANIFICADO |

### 13.9 Demografia y economia

| Proveedor | Categoria | Cobertura | Datos clave | Metodo de acceso | Autenticacion | Cadencia | Modelo comercial | Notas de licencia/uso | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| U.S. Census API | Demographics | USA | ACS, population, income | API REST | API key | Annual | Publico | Ref: https://api.census.gov/data.html | CANDIDATO |
| BLS API | Labor/economy | USA | Employment, CPI, wages | API REST | API key | Monthly/Quarterly | Publico | Ref: https://www.bls.gov/developers/ | CANDIDATO |
| BEA API | Macro | USA | GDP, income, regional data | API REST | API key | Quarterly/Annual | Publico | Ref: https://apps.bea.gov/api/signup/ | CANDIDATO |
| FHFA HPI Data | Housing | USA | House Price Index | Dataset download | N/A | Quarterly | Publico | Ref: https://www.fhfa.gov/DataTools/Downloads/Pages/House-Price-Index-Datasets.aspx | CANDIDATO |

### 13.10 Corporativo y beneficial ownership

| Proveedor | Categoria | Cobertura | Datos clave | Metodo de acceso | Autenticacion | Cadencia | Modelo comercial | Notas de licencia/uso | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Florida Division of Corporations (Sunbiz) | Corporate registry | Florida | Entity filings, officers, status | Portal search | N/A | Variable | Publico | Ref: https://search.sunbiz.org/ | CANDIDATO |
| OpenCorporates API | Company registry | Global | Company profiles, officers | API REST | API key | On-demand | Freemium/paid | Ref: https://opencorporates.com/info/api | CANDIDATO |
| GLEIF API | LEI registry | Global | LEI, legal entity data | API REST | N/A | On-demand | Publico | Ref: https://www.gleif.org/en/lei-data/access-and-use-lei-data/api-access | CANDIDATO |

### 13.11 KYC/AML

| Proveedor | Categoria | Cobertura | Datos clave | Metodo de acceso | Autenticacion | Cadencia | Modelo comercial | Notas de licencia/uso | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Trulioo API | KYC/AML | Global | Identity verification, AML checks | API REST | API key | On-demand | Commercial | Ref: https://developer.trulioo.com/ | CANDIDATO |
| Sumsub API | KYC/AML | Global | Identity verification, AML checks | API REST | X-App-Token + X-App-Access-Sig | On-demand | Commercial | Ref: https://developers.sumsub.com/api-reference/ | CANDIDATO |
| Onfido API (Entrust) | KYC/AML | Global | Identity verification | API REST | API token | On-demand | Commercial | Ref: https://documentation.onfido.com/ | CANDIDATO |

### 13.12 Comunicacion y productividad

| Proveedor | Categoria | Cobertura | Datos clave | Metodo de acceso | Autenticacion | Cadencia | Modelo comercial | Notas de licencia/uso | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gmail API (Google Workspace) | Email | Global | Emails, threads, labels | API REST | OAuth 2.0 (scopes) | On-demand | Commercial | Ref: https://developers.google.com/workspace/gmail/api/auth/scopes | CANDIDATO |
| Microsoft Graph (Outlook/Calendar) | Email/Calendar | Global | Mail, calendar, contacts | API REST | OAuth 2.0 (Entra ID) | On-demand | Commercial | Ref: https://learn.microsoft.com/en-us/graph/auth/auth-concepts | CANDIDATO |
| Twilio Messaging API | SMS/MMS | Global | SMS/MMS send/receive | API REST | HTTP Basic (Account SID + Auth Token / API key) | On-demand | Usage-based | Ref: https://www.twilio.com/docs/messaging/api | CANDIDATO |
| Slack API | Collaboration | Global | Messages, channels, alerts | API REST | OAuth 2.0 (Bearer token) | On-demand | Commercial | Ref: https://docs.slack.dev/authentication/installing-with-oauth | CANDIDATO |
| Microsoft Teams (Graph) | Collaboration | Global | Messages, channels, meetings | API REST | OAuth 2.0 (Entra ID) | On-demand | Commercial | Ref: https://learn.microsoft.com/en-us/graph/auth/auth-concepts | CANDIDATO |

### 13.13 Firma y documentos

| Proveedor | Categoria | Cobertura | Datos clave | Metodo de acceso | Autenticacion | Cadencia | Modelo comercial | Notas de licencia/uso | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DocuSign eSignature API | E-signature | Global | Envelopes, signing | API REST | OAuth 2.0 | On-demand | Commercial | Ref: https://www.docusign.com/blog/developers/docusign-api-basic-user-password-authentication-retirement (OAuth 2.0 requerido) | CANDIDATO |
| Adobe Sign API | E-signature | Global | Agreements, signing | API REST | OAuth 2.0 | On-demand | Commercial | Ref: https://developer.adobe.com/document-services/apis/sign-api/ | CANDIDATO |
| Dropbox Sign API | E-signature | Global | Signature requests | API REST | Basic (API key) o OAuth Bearer | On-demand | Commercial | Ref: https://developers.hellosign.com/api/reference/authentication/ | CANDIDATO |

### 13.14 Storage y data rooms

| Proveedor | Categoria | Cobertura | Datos clave | Metodo de acceso | Autenticacion | Cadencia | Modelo comercial | Notas de licencia/uso | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Google Drive API | Storage | Global | Files, folders, permissions | API REST | OAuth 2.0 (scopes) | On-demand | Commercial | Ref: https://developers.google.com/drive/api/guides/api-specific-auth | CANDIDATO |
| Dropbox API | Storage | Global | Files, folders, permissions | API REST | OAuth 2.0 (Bearer) | On-demand | Commercial | Ref: https://developers.dropbox.com/oauth-guide | CANDIDATO |
| Box API | Storage | Global | Files, folders, permissions | API REST | OAuth 2.0 / JWT / Client Credentials | On-demand | Commercial | Ref: https://box.dev/guides/authentication/ | CANDIDATO |
| Microsoft OneDrive/SharePoint (Graph) | Storage | Global | Files, sites, drives | API REST | OAuth 2.0 (Entra ID) | On-demand | Commercial | Ref: https://learn.microsoft.com/en-us/graph/onedrive-concept-overview | CANDIDATO |

### 13.15 Analytics y observabilidad

| Proveedor | Categoria | Cobertura | Datos clave | Metodo de acceso | Autenticacion | Cadencia | Modelo comercial | Notas de licencia/uso | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Segment | Event tracking | Global | Events, user traits | HTTP API (Tracking) | writeKey / Basic / OAuth | Real-time | Commercial | Ref: https://www.twilio.com/docs/segment/connections/sources/catalog/libraries/server/http-api | CANDIDATO |
| RudderStack | Event tracking | Global | Events, pipelines | HTTP API | Basic (Service Access Token) | Real-time | Commercial/OSS | Ref: https://www.rudderstack.com/docs/api/http-api/ | CANDIDATO |
| Datadog API | Observability | Global | Logs, metrics, traces | API REST | API key + application key | Real-time | Commercial | Ref: https://docs.datadoghq.com/api/latest/authentication/ | CANDIDATO |
| New Relic API | Observability | Global | Telemetry, APM | API REST | API keys (license/user) | Real-time | Commercial | Ref: https://docs.newrelic.com/docs/apis/intro-apis/new-relic-api-keys/ | CANDIDATO |
| Sentry API | Observability | Global | Errors, issues | API REST | Bearer token | Real-time | Commercial | Ref: https://docs.sentry.io/api/auth/ | CANDIDATO |

## 14. Integration readiness checklist

Objetivo: estandarizar el proceso de evaluacion e integracion de nuevas fuentes.

Checklist operativo (antes de aprobar un conector):
1. Acceso y licencia: contrato vigente, uso permitido para proposito interno, terminos de redistribucion claros.
2. Cobertura y calidad: cobertura geografica valida para Miami-Dade, Broward, Palm Beach; definicion de campos y diccionario.
3. Metodo de acceso: API/bulk/SFTP definido, autenticacion soportada por el stack, disponibilidad de sandbox si aplica.
4. Cadencia y SLA: frecuencia de actualizacion, limites de rate, ventanas de mantenimiento.
5. Costos: pricing claro por uso o por dataset, costos de backfill inicial.
6. Riesgo legal/compliance: PII, restricciones de almacenamiento, requerimientos de borrado.
7. Integracion tecnica: formato de datos, volumen, compatibilidad con staging y ETL.
8. Resolucion de entidades: posibilidad de mapear parcel/folio/APN, owners y direcciones.
9. Observabilidad: endpoints de health, respuestas de error, trazabilidad por request.
10. Plan de mantenimiento: versionado de API, politica de cambios y soporte del proveedor.

Artefactos de salida (por conector aprobado):
1. Ficha de integracion con campos del catalogo.
2. Mapping table a entidades internas (`deals`, `owners`, `deal_metrics`).
3. Plan de backfill + incremental sync.
4. Estrategia de deduplicacion y reconciliacion.
5. Runbook de errores y alertas.

## 15. Priorizacion por ROI (modelo y ranking inicial)

Modelo de scoring (1 a 5):
- Impacto en originacion (I): incremento esperado en oportunidades accionables.
- Cobertura y unicidad (C): datos no disponibles en otras fuentes o con mejor resolucion.
- Freshness (F): frecuencia de actualizacion util para detectar eventos.
- Acceso/costo (A): facilidad de acceso y costo relativo (5 = facil y economico).
- Esfuerzo de integracion (E): complejidad tecnica (5 = baja complejidad).

Score total sugerido:
`ROI_SCORE = 0.30*I + 0.20*C + 0.15*F + 0.15*A + 0.20*E`

Guia de decision:
- P0 (prioridad inmediata): ROI_SCORE >= 4.0
- P1 (alta): 3.4 a 3.9
- P2 (media): 2.8 a 3.3
- P3 (baja): < 2.8

Ranking inicial recomendado (ajustable segun estrategia):
1. Miami-Dade Property Appraiser (bulk data) - base parcel/owner.
2. Clerks/Official Records (Miami-Dade, Broward, Palm Beach) - deeds, mortgages, lis pendens.
3. Open Data GIS (condados) - zoning, permits, code enforcement.
4. Tax Collectors (condados) - delinquency signals.
5. FEMA NFHL + NOAA CO-OPS - riesgo/flood coastal para scoring.
6. CoStar (si ya licenciado) - mercado y comps.
7. ATTOM o Regrid (cobertura nacional complementaria).
8. Census/BLS/BEA - contexto macro para scoring.
9. Gmail + Twilio - ejecucion de outreach y trazabilidad.
10. DocuSign/Drive - cierre y data rooms.

Nota: el ranking es un punto de partida. Debe recalibrarse cada trimestre con feedback de negocio, costos reales y performance del pipeline.

## 16. Estado implementado (backend/frontend - 2026-02-08)

Backend implementado:
- Auth:
  - `POST /api/auth/login` -> `{ accessToken, refreshToken, user }` + cookies HttpOnly
  - `POST /api/auth/refresh` -> rota refresh token, renueva sesion y cookies
  - `POST /api/auth/logout` -> revoca refresh token y limpia cookies
  - `GET /api/auth/me` -> usuario actual por cookie o bearer (fallback temporal)
  - Google OAuth: `GET /api/auth/google`, `GET /api/auth/google/callback`, `GET /api/auth/google/status`
- Guard global JWT + guard global RBAC activo; rutas publicas limitadas a health + auth publico.
- Integraciones:
  - `GET /api/integrations/status`
  - `GET /api/integrations/connected`
  - `GET /api/integrations/runs?source=&limit=`
  - `POST /api/integrations/:source/sync` (solo `ADMIN`) -> `{ status, message, runId, metrics }`
- Deals:
  - `GET /api/deals` con paginacion estandar `{ items, total, limit, offset }`
  - filtros tipados y validados en backend
- Reports:
  - `GET /api/reports/pipeline`
  - `GET /api/reports/pipeline.csv`
  - `GET /api/reports/pipeline.pdf`

Data model implementado:
- `RefreshToken` para sesiones seguras con expiracion/revocacion.
- `IntegrationRun` para auditoria de corridas de conectores.
- `DealOwner @@unique([dealId, ownerId])` para evitar duplicados.
- Indices de consultas frecuentes en `Deal` y `StagingRecord`.
- `StagingRecord.sourceRecordId` para trazabilidad a fuente original.

Frontend implementado:
- Cliente de API con cookies HttpOnly + refresh automatico en `401`.
- Guard de sesion en `/deals`, `/deals/:id`, `/reports`, `/settings/integrations`.
- `/deals` con filtros, paginacion y quick actions de estado.
- `/settings/integrations` muestra estado, sync y historial de runs.
- `/reports` descarga CSV/PDF via endpoints autenticados.
