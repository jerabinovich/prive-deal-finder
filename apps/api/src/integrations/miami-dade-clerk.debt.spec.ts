import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  MIAMI_DADE_CLERK_SOURCE,
  RECORDED_DEBT_STAGING_STATUS,
  parseClerkResult,
  readClerkResultFile,
  readRecordedDebt,
  resolveClerkResultPath,
  storeRecordedDebt,
} from "./miami-dade-clerk.debt";

const FIXTURE = path.join(__dirname, "fixtures", "miami-dade-clerk-resultado.sample.json");

// El fixture lo genera el estado_deuda REAL de consultar.py (parche 5), no una copia a mano.
function fixture() {
  return JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Record<string, any>;
}

describe("deuda registrada del Clerk: parseo de resultado.json", () => {
  it("normaliza las corridas con datos y las sin registros, y saltea el resto con motivo", () => {
    const parsed = parseClerkResult(fixture());
    expect(parsed.runAt).toBe("2026-09-22T12:10:07");
    expect(parsed.snapshots.map((s) => [s.folio, s.outcome])).toEqual([
      ["3031210000490", "RECORDS_FOUND"],
      ["3031010032900", "RECORDS_FOUND"],
      ["3022200021810", "RECORDS_FOUND"],
      ["3040000000010", "RECORDS_FOUND"],
      ["3050000000020", "RECORDS_FOUND"],
      ["3060000000030", "NO_RECORDS"],
    ]);
    expect(parsed.skipped.map((s) => s.folio)).toEqual(["3070000000040", "3080000000050", "3090000000060"]);
    expect(parsed.skipped[0].reason).toContain("timed out");
    expect(parsed.skipped[1].reason).toContain("Invalid Parameter");
    expect(parsed.skipped[2].reason).toContain("parche 5");
  });

  it("mantiene hipotecas, estados, traspaso, gravamenes y documentos de deuda del script", () => {
    const a = parseClerkResult(fixture()).snapshots[0];
    expect(a.likelyOutstandingDebt).toBe(7270000);
    expect(a.recordedDebtCeiling).toBe(7270000);
    expect(a.queriedAt).toBe("2026-09-22T08:31:37");
    expect(a.mortgages).toEqual([
      expect.objectContaining({ cfn: "2019-100002", recordedOn: "2019-03-01", amount: 6000000, status: "RELEASED", reason: "por 2021-200001" }),
      expect.objectContaining({ cfn: "2025-944351", recordedOn: "2025-12-10", amount: 7270000, status: "LIKELY_OUTSTANDING", reason: "" }),
    ]);
    expect(a.mortgages[1].parties).toEqual(["BUYER ALPHA LLC", "LENDER TWO CAPITAL LLC"]);
    expect(a.lastTransfer).toEqual({ cfn: "2019-100001", recordedOn: "2019-03-01", docType: "WD", price: 10000000 });
    expect(a.otherDebtDocuments.map((d) => [d.docType, d.recordedOn, d.amount])).toEqual([
      ["LIS", "2026-08-01", 0],
      ["JUD", "2024-09-09", 125000],
    ]);
    expect(a.liens).toEqual({
      total: 3,
      releasedInIndex: 1,
      last24Months: 1,
      lastRecordedOn: "2025-11-01",
      frequentParties: [
        { name: "BUYER ALPHA LLC", count: 3 },
        { name: "CITY OF MIAMI", count: 2 },
        { name: "CONTRACTOR BETA INC", count: 1 },
      ],
    });
  });

  it("la suma vigente probable coincide con las hipotecas marcadas vigentes", () => {
    for (const snap of parseClerkResult(fixture()).snapshots) {
      const sum = snap.mortgages.filter((m) => m.status === "LIKELY_OUTSTANDING").reduce((t, m) => t + m.amount, 0);
      expect(snap.likelyOutstandingDebt).toBe(Math.round(sum));
    }
  });

  it("traduce los cuatro estados del script, incluida la cancelacion por libro y pagina y el CTI", () => {
    const [, , c, h, i] = parseClerkResult(fixture()).snapshots;
    expect(c.mortgages.map((m) => m.status)).toEqual(["LIKELY_OUTSTANDING", "PREDATES_TRANSFER", "PREDATES_TRANSFER", "LIKELY_OUTSTANDING"]);
    expect(c.mortgages[0].recordedOn).toBeNull();
    expect(c.mortgages[0].reason).toContain("sin fecha legible");
    expect(c.titleCertificates).toEqual(["2012-02-02"]);
    expect(c.lastTransfer?.docType).toBe("CTI");
    expect(h.mortgages[0].status).toBe("RELEASED");
    expect(i.lastPurchaseWithoutLaterMortgage).toBe(true);
  });

  it("sin registros usa la hora de la corrida y no inventa deuda", () => {
    const empty = parseClerkResult(fixture()).snapshots[5];
    expect(empty).toEqual(expect.objectContaining({ outcome: "NO_RECORDS", queriedAt: "2026-09-22T12:10:07", likelyOutstandingDebt: 0, documentCount: 0 }));
  });

  it("no guarda la IP ni el saldo de la cuenta", () => {
    const text = JSON.stringify(parseClerkResult(fixture()));
    expect(text).not.toContain("100.64.1.2");
    expect(text).not.toContain("saldo");
    expect(text).not.toContain("\"ip\"");
  });

  it("rechaza entero un archivo que no es una corrida COMPLETA", () => {
    const aborted = { ...fixture(), estado: "ABORTADA en la consulta 3" };
    expect(() => parseClerkResult(aborted)).toThrow("no es una corrida COMPLETA");
    expect(() => parseClerkResult({ estado: "COMPLETA" })).toThrow("no trae resultados");
    expect(() => parseClerkResult([])).toThrow("no es un objeto");
  });

  it("saltea claves que no son folios y respuestas vacias que no dicen No Records Found", () => {
    const parsed = parseClerkResult({
      estado: "COMPLETA",
      corrida: "2026-09-22T00:00:00",
      resultados: {
        "30-3121-000-0490": { documentos: 0, status_desc: "No Records Found" },
        abc: {},
        "3031210000490": { documentos: 0, status_desc: "Record Found" },
      },
    });
    expect(parsed.snapshots).toEqual([]);
    expect(parsed.skipped.map((s) => s.reason)).toEqual([
      "clave que no es un folio",
      "clave que no es un folio",
      expect.stringContaining("No Records Found"),
    ]);
  });
});

describe("deuda registrada del Clerk: archivo", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-"));
  const saved = process.env.MIAMI_DADE_CLERK_RESULT_PATH;
  afterAll(() => {
    if (saved === undefined) delete process.env.MIAMI_DADE_CLERK_RESULT_PATH;
    else process.env.MIAMI_DADE_CLERK_RESULT_PATH = saved;
  });

  it("encuentra el archivo por la variable de entorno y lista lo que reviso", () => {
    const file = path.join(tmp, "resultado.json");
    fs.writeFileSync(file, "{}");
    process.env.MIAMI_DADE_CLERK_RESULT_PATH = file;
    const found = resolveClerkResultPath();
    expect(found.resolvedPath).toBe(file);
    expect(found.checkedPaths[0]).toBe(file);
    expect(found.checkedPaths.some((p) => p.endsWith(path.join("miami-dade-official-records", "resultado.json")))).toBe(true);
  });

  it("un JSON roto se informa con un error legible", () => {
    const file = path.join(tmp, "roto.json");
    fs.writeFileSync(file, "{ no es json");
    expect(() => readClerkResultFile(file)).toThrow("no es JSON valido");
  });
});

describe("deuda registrada del Clerk: guardado y lectura", () => {
  function store() {
    const rows: Array<{ source: string; sourceRecordId: string; payload: string; status: string; receivedAt: Date }> = [];
    const prisma = {
      stagingRecord: {
        findFirst: jest.fn(async ({ where }: any) => {
          const match = rows.filter((r) => r.source === where.source && r.sourceRecordId === where.sourceRecordId);
          return match.length ? match[match.length - 1] : null;
        }),
        create: jest.fn(async ({ data }: any) => {
          rows.push({ ...data, receivedAt: new Date() });
          return data;
        }),
      },
      deal: {
        findMany: jest.fn(async () => [{ parcelId: "3031210000490" }, { parcelId: "3031010032900" }]),
      },
    };
    return { prisma, rows };
  }

  it("una fila por folio, y reimportar el mismo archivo no agrega nada", async () => {
    const { prisma, rows } = store();
    const { snapshots } = parseClerkResult(fixture());

    const first = await storeRecordedDebt(prisma as any, snapshots);
    expect(first).toEqual(expect.objectContaining({ folios: 6, storedRecords: 6, unchangedRecords: 0, matchedDeals: 2 }));
    expect(first.unmatchedFolios).toHaveLength(4);
    expect(rows.every((r) => r.source === MIAMI_DADE_CLERK_SOURCE && r.status === RECORDED_DEBT_STAGING_STATUS)).toBe(true);

    const again = await storeRecordedDebt(prisma as any, snapshots);
    expect(again).toEqual(expect.objectContaining({ storedRecords: 0, unchangedRecords: 6 }));
    expect(rows).toHaveLength(6);
  });

  it("si cambia la consulta de un folio, agrega una fila nueva y la lectura trae la ultima", async () => {
    const { prisma, rows } = store();
    const { snapshots } = parseClerkResult(fixture());
    await storeRecordedDebt(prisma as any, snapshots);
    const changed = { ...snapshots[1], likelyOutstandingDebt: 1, queriedAt: "2026-10-01T09:00:00" };
    const result = await storeRecordedDebt(prisma as any, [changed]);
    expect(result.storedRecords).toBe(1);
    expect(rows).toHaveLength(7);

    const view = await readRecordedDebt(prisma as any, { parcelId: "3031010032900", market: "Miami-Dade" });
    expect(view.available).toBe(true);
    if (view.available) {
      expect(view.informationalOnly).toBe(true);
      expect(view.snapshot.likelyOutstandingDebt).toBe(1);
    }
  });

  it("la lectura explica por que no hay dato", async () => {
    const { prisma } = store();
    expect(await readRecordedDebt(prisma as any, { parcelId: null, market: "Miami-Dade" })).toEqual(
      expect.objectContaining({ available: false, reason: "El deal no tiene folio." }),
    );
    expect(await readRecordedDebt(prisma as any, { parcelId: "484220CM0410", market: "Broward" })).toEqual(
      expect.objectContaining({ available: false, reason: expect.stringContaining("solo cubre folios de Miami-Dade") }),
    );
    expect(await readRecordedDebt(prisma as any, { parcelId: "3031210000490", market: "Miami-Dade" })).toEqual(
      expect.objectContaining({ available: false, reason: expect.stringContaining("no está en la consulta") }),
    );
  });

  it("una fila con otro formato no rompe la ficha", async () => {
    const prisma = {
      stagingRecord: { findFirst: jest.fn(async () => ({ payload: "{\"schemaVersion\":99}", receivedAt: new Date() })) },
    };
    expect(await readRecordedDebt(prisma as any, { parcelId: "3031210000490", market: null })).toEqual(
      expect.objectContaining({ available: false, reason: expect.stringContaining("volver a importar") }),
    );
  });
});
