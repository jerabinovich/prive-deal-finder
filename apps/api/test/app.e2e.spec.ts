import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import * as request from "supertest";
import * as path from "path";
import { AppModule } from "../src/app.module";

describe("App (e2e)", () => {
  let app: INestApplication;
  let accessToken = "";
  let refreshToken = "";
  let adminAccessToken = "";
  let dealId = "";

  beforeAll(async () => {
    process.env.AUTH_ADMIN_EMAILS = "admin@privegroup.com";
    process.env.MDPA_MAX_ROWS = "25";
    process.env.MDPA_BULK_FILE_PATH = path.resolve(__dirname, "../resources/mdpa_bulk_seed.csv");

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects protected route without token", async () => {
    const res = await request(app.getHttpServer()).get("/api/deals");
    expect(res.status).toBe(401);
  });

  it("logs in and gets session tokens", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "qa@privegroup.com" });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();

    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it("returns current user from auth/me", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe("qa@privegroup.com");
  });

  it("refreshes token", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/refresh")
      .send({ refreshToken });

    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it("returns paginated deals payload", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/deals?limit=5&offset=0&sortBy=score&sortDir=desc")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(typeof res.body.total).toBe("number");
    expect(res.body.limit).toBe(5);
    expect(res.body.offset).toBe(0);
    if (res.body.items.length > 0) {
      expect(res.body.items[0].pipelineScore).toBeDefined();
      expect(res.body.items[0].classification).toBeDefined();
    }
  });

  it("returns deal facets and supports property-use filtering", async () => {
    const facetsRes = await request(app.getHttpServer())
      .get("/api/deals/facets")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(facetsRes.status).toBe(200);
    expect(Array.isArray(facetsRes.body.assetTypes)).toBe(true);
    expect(Array.isArray(facetsRes.body.propertyUseCodes)).toBe(true);

    const selectedPropertyUseCode = facetsRes.body.propertyUseCodes?.[0]?.value;
    if (selectedPropertyUseCode) {
      const filteredRes = await request(app.getHttpServer())
        .get(`/api/deals?propertyUseCode=${encodeURIComponent(selectedPropertyUseCode)}&limit=10&offset=0`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(filteredRes.status).toBe(200);
      expect(Array.isArray(filteredRes.body.items)).toBe(true);
      expect(filteredRes.body.items.every((row: { propertyUseCode?: string }) =>
        typeof row.propertyUseCode === "string" &&
        row.propertyUseCode.toLowerCase().includes(String(selectedPropertyUseCode).toLowerCase())
      )).toBe(true);
    }
  });

  it("returns integration runs list", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/integrations/runs?limit=5&sortBy=startedAt&sortDir=desc")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 0) {
      expect(typeof res.body[0].runType).toBe("string");
      expect(typeof res.body[0].severity).toBe("string");
      expect(typeof res.body[0].tableMessage).toBe("string");
      expect(Array.isArray(res.body[0].anomalies)).toBe(true);
      expect(Array.isArray(res.body[0].nextActions)).toBe(true);
    }
  });

  it("filters integrations status and runs with query params", async () => {
    const statusRes = await request(app.getHttpServer())
      .get("/api/integrations/status?configured=true")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(statusRes.status).toBe(200);
    expect(Array.isArray(statusRes.body)).toBe(true);
    expect(statusRes.body.every((row: { configured: boolean }) => row.configured === true)).toBe(true);

    const runsRes = await request(app.getHttpServer())
      .get("/api/integrations/runs?status=OK&sortBy=source&sortDir=asc&limit=10&operatorView=true")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(runsRes.status).toBe(200);
    expect(Array.isArray(runsRes.body)).toBe(true);
    expect(runsRes.body.every((row: { status: string }) => row.status === "OK")).toBe(true);
  }, 20000);

  it("forbids sync for ANALYST role", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/integrations/mdpa/sync")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(403);
  });

  it("forbids bulk backfill for ANALYST role", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/deals/backfill-facts")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ limit: 5 });

    expect(res.status).toBe(403);
  });

  it("allows sync for ADMIN role", async () => {
    const loginRes = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ email: "admin@privegroup.com" });

    expect(loginRes.status).toBe(201);
    adminAccessToken = loginRes.body.accessToken;

    const syncRes = await request(app.getHttpServer())
      .post("/api/integrations/mdpa/sync")
      .set("Authorization", `Bearer ${adminAccessToken}`)
      .send({ confirmPaidDataUse: true });

    expect(syncRes.status).toBe(201);
    expect(syncRes.body.status).toBeTruthy();
  });

  it("returns mdpa catalog and allows mdpa import for ADMIN", async () => {
    const catalogRes = await request(app.getHttpServer())
      .get("/api/integrations/mdpa/catalog")
      .set("Authorization", `Bearer ${adminAccessToken}`);

    expect(catalogRes.status).toBe(200);
    expect(Array.isArray(catalogRes.body)).toBe(true);

    const importRes = await request(app.getHttpServer())
      .post("/api/integrations/mdpa/import")
      .set("Authorization", `Bearer ${adminAccessToken}`)
      .send({
        datasetType: "MUNICIPAL_ROLLS",
        confirmPaidDataUse: true,
      });

    expect(importRes.status).toBe(201);
    expect(importRes.body.status).toBe("OK");

    const aliasCatalog = await request(app.getHttpServer())
      .get("/api/mdpa/catalog")
      .set("Authorization", `Bearer ${adminAccessToken}`);
    expect(aliasCatalog.status).toBe(200);

    const aliasImport = await request(app.getHttpServer())
      .post("/api/mdpa/import")
      .set("Authorization", `Bearer ${adminAccessToken}`)
      .send({
        datasetType: "MUNICIPAL_ROLLS",
        confirmPaidDataUse: true,
      });
    expect(aliasImport.status).toBe(201);
  });

  it("returns deal overview", async () => {
    const dealsRes = await request(app.getHttpServer())
      .get("/api/deals?limit=1&offset=0")
      .set("Authorization", `Bearer ${adminAccessToken}`);

    expect(dealsRes.status).toBe(200);
    expect(Array.isArray(dealsRes.body.items)).toBe(true);
    expect(dealsRes.body.items.length).toBeGreaterThan(0);

    dealId = dealsRes.body.items[0].id;

    const overviewRes = await request(app.getHttpServer())
      .get(`/api/deals/${dealId}/overview`)
      .set("Authorization", `Bearer ${adminAccessToken}`);

    expect(overviewRes.status).toBe(200);
    expect(overviewRes.body.deal.id).toBe(dealId);
    expect(Array.isArray(overviewRes.body.media)).toBe(true);
    expect(Array.isArray(overviewRes.body.documents)).toBe(true);
    expect(Array.isArray(overviewRes.body.comparables)).toBe(true);
    expect(Array.isArray(overviewRes.body.sales)).toBe(true);
    expect(Array.isArray(overviewRes.body.assessments)).toBe(true);
    expect(typeof overviewRes.body.completeness?.score).toBe("number");
    expect(overviewRes.body.opportunitySummary?.classification).toBeDefined();
    expect(overviewRes.body.opportunitySummary?.gates).toBeDefined();
    expect(overviewRes.body.investmentThesis?.headline).toBeDefined();
  });

  it("filters reports pipeline with query params", async () => {
    const reportRes = await request(app.getHttpServer())
      .get("/api/reports/pipeline?sortBy=count&sortDir=desc")
      .set("Authorization", `Bearer ${adminAccessToken}`);

    expect(reportRes.status).toBe(200);
    expect(Array.isArray(reportRes.body)).toBe(true);

    const csvRes = await request(app.getHttpServer())
      .get("/api/reports/pipeline.csv?sortBy=avgScore&sortDir=asc")
      .set("Authorization", `Bearer ${adminAccessToken}`);
    expect(csvRes.status).toBe(200);
    expect(typeof csvRes.text).toBe("string");
  });

  it("supports opportunity classification filter and chat thesis payload", async () => {
    const listRes = await request(app.getHttpServer())
      .get("/api/deals?classification=PIPELINE_LISTING&limit=5&offset=0")
      .set("Authorization", `Bearer ${adminAccessToken}`);

    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.items)).toBe(true);

    const chatRes = await request(app.getHttpServer())
      .post("/api/chat/query")
      .set("Authorization", `Bearer ${adminAccessToken}`)
      .send({
        question: "por que esto es un deal",
        dealId,
        taskType: "DEAL_DEEP_DIVE",
        appState: {
          route: `/deals/${dealId}`,
          selectedDealId: dealId,
        },
        uiCapabilities: ["OPEN_DEAL", "RECOMPUTE_COMPS", "RECOMPUTE_INSIGHTS", "MOVE_STAGE"],
      });
    expect(chatRes.status).toBe(201);
    expect(typeof chatRes.body.answer).toBe("string");
    expect(typeof chatRes.body.assistantMessageEs).toBe("string");
    expect(typeof chatRes.body.taskTypeResolved).toBe("string");
    expect(Array.isArray(chatRes.body.uiActions)).toBe(true);
    expect(Array.isArray(chatRes.body.quickReplies)).toBe(true);
    expect(Array.isArray(chatRes.body.guardrailsTriggered)).toBe(true);
    expect(typeof chatRes.body.thesis).toBe("string");
    expect(typeof chatRes.body.nextAction).toBe("string");
    expect(chatRes.body.intent).toBeDefined();
  });

  it("runs bulk backfill summary for ADMIN role", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/deals/backfill-facts")
      .set("Authorization", `Bearer ${adminAccessToken}`)
      .send({
        limit: 1,
        onlyMissingFacts: true,
        recomputeComparables: false,
        recomputeInsights: false,
        dryRun: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.filters.limit).toBe(1);
    expect(res.body.filters.dryRun).toBe(true);
    expect(typeof res.body.totals.candidates).toBe("number");
    expect(typeof res.body.totals.processed).toBe("number");
    expect(typeof res.body.totals.insightsRecomputed).toBe("number");
  });

  it("recomputes operational triage and exposes lane/action filters", async () => {
    const recomputeRes = await request(app.getHttpServer())
      .post("/api/deals/recompute-triage")
      .set("Authorization", `Bearer ${adminAccessToken}`)
      .send({ limit: 10 });

    expect(recomputeRes.status).toBe(201);
    expect(typeof recomputeRes.body.processed).toBe("number");

    const listRes = await request(app.getHttpServer())
      .get("/api/deals?limit=10&offset=0&lane=OFF_MARKET_STANDARD")
      .set("Authorization", `Bearer ${adminAccessToken}`);

    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.items)).toBe(true);
  });

  it("creates media and document entries", async () => {
    const mediaRes = await request(app.getHttpServer())
      .post(`/api/deals/${dealId}/media`)
      .set("Authorization", `Bearer ${adminAccessToken}`)
      .send({
        kind: "PHOTO",
        url: "https://example.com/photo.jpg",
        caption: "Front elevation",
      });

    expect(mediaRes.status).toBe(201);
    expect(mediaRes.body.id).toBeTruthy();

    const docRes = await request(app.getHttpServer())
      .post(`/api/deals/${dealId}/documents`)
      .set("Authorization", `Bearer ${adminAccessToken}`)
      .send({
        kind: "OM",
        title: "Offering Memorandum",
        url: "https://example.com/om.pdf",
      });

    expect(docRes.status).toBe(201);
    expect(docRes.body.id).toBeTruthy();
  });

  it("recomputes comparables and insights", async () => {
    const compsRes = await request(app.getHttpServer())
      .post(`/api/deals/${dealId}/recompute-comps`)
      .set("Authorization", `Bearer ${adminAccessToken}`)
      .send({});

    expect(compsRes.status).toBe(201);
    expect(compsRes.body.message).toBeTruthy();

    const insightsRes = await request(app.getHttpServer())
      .post(`/api/deals/${dealId}/recompute-insights`)
      .set("Authorization", `Bearer ${adminAccessToken}`)
      .send({});

    expect(insightsRes.status).toBe(201);
    expect(insightsRes.body.updatedAt).toBeTruthy();
    expect(insightsRes.body.valuation).toBeTruthy();
  });

  it("logout revokes refresh token", async () => {
    const logoutRes = await request(app.getHttpServer())
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ refreshToken });

    expect(logoutRes.status).toBe(201);
    expect(logoutRes.body.success).toBe(true);

    const refreshRes = await request(app.getHttpServer())
      .post("/api/auth/refresh")
      .send({ refreshToken });

    expect(refreshRes.status).toBe(401);
  });
});
