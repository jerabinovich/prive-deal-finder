# Access and Credentials Checklist

This checklist captures required access to run the internal launch with real data.

## Core data sources (free)
1. Miami-Dade Property Appraiser (MDPA) bulk data
- Access: account + credits to download bulk CSV
- Delivery: portal download (weekly)
- Status: account connected; local fallback loaded at `data/mdpa/mdpa_bulk_latest.csv`
- Needed: load production MDPA bulk file for staging/prod (no sample fallback)
- Credit protection policy: see `docs/MDPA_BBS_OPERATING_POLICY.md`

2. Miami-Dade Parcels (ArcGIS)
- Access: public ArcGIS FeatureServer
- Needed: none (URL configured)

3. Broward Parcels (ArcGIS)
- Access: public ArcGIS FeatureServer
- Needed: none (URL configured)

4. Palm Beach Parcels (ArcGIS)
- Access: public ArcGIS FeatureServer
- Needed: none (URL configured)

## Auth and outreach
5. Google Workspace (SSO + Gmail API)
- Required: OAuth client ID/secret, admin consent, scopes
- Redirect URI (local): `http://localhost:4000/api/auth/google/callback`
- Needed: rotate client secret if exposed; confirm production redirect URI/domain

6. Twilio
- Required: Account SID, Auth Token, sender numbers
- Needed: verified sending number and messaging approval

## Infrastructure
7. PostgreSQL (staging/prod)
- Required: `DATABASE_URL`
- Local default: `postgresql://postgres:postgres@localhost:5432/prive_deal_finder?schema=public`

8. AWS
- S3 bucket for artifacts/exports
- Secrets Manager access
- ECS/Fargate (or selected runtime)

## Security baseline
9. JWT secrets
- Set strong `JWT_SECRET`
- Set strong `JWT_REFRESH_SECRET`
- Do not use defaults in staging/prod

10. Admin bootstrap for protected ops
- Required for sync endpoints: `AUTH_ADMIN_EMAILS` (comma-separated)
- Include at least one operator email for staging smoke runs

11. Auth cookie policy
- `AUTH_COOKIE_SECURE=true` in staging/prod (TLS required)
- `AUTH_COOKIE_SAME_SITE` and optional `AUTH_COOKIE_DOMAIN` defined for target domain

## Optional (later)
12. Clerk/Recorder bulk access for Miami-Dade/Broward/Palm Beach
13. Additional providers from `docs/ARCHITECTURE.md`
