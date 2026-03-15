import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { MdpaIngestService } from "./mdpa.ingest";

describe("MdpaIngestService", () => {
  const prisma = {
    mdpaDatasetSnapshot: {
      create: jest.fn(),
      update: jest.fn(),
    },
    mdpaSale: {
      create: jest.fn(),
    },
    mdpaAssessment: {
      upsert: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    mdpaRollEvent: {
      findFirst: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    deal: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    owner: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    dealOwner: {
      upsert: jest.fn(),
    },
  } as any;

  const service = new MdpaIngestService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.mdpaDatasetSnapshot.create.mockResolvedValue({ id: "snapshot-1" });
    prisma.mdpaDatasetSnapshot.update.mockResolvedValue({});
    prisma.mdpaSale.create.mockResolvedValue({});
    prisma.mdpaAssessment.upsert.mockResolvedValue({});
    prisma.mdpaAssessment.findFirst.mockResolvedValue(null);
    prisma.mdpaAssessment.update.mockResolvedValue({});
    prisma.mdpaAssessment.create.mockResolvedValue({});
    prisma.mdpaRollEvent.findFirst.mockResolvedValue(null);
    prisma.mdpaRollEvent.update.mockResolvedValue({});
    prisma.mdpaRollEvent.create.mockResolvedValue({});
    prisma.deal.findFirst.mockResolvedValue(null);
    prisma.deal.create.mockImplementation(async ({ data }: { data: { name: string } }) => ({
      id: `deal-${data.name}`,
      ...data,
    }));
    prisma.owner.findFirst.mockResolvedValue(null);
    prisma.owner.create.mockImplementation(async ({ data }: { data: { name: string } }) => ({
      id: `owner-${data.name}`,
      ...data,
    }));
    prisma.dealOwner.upsert.mockResolvedValue({});
  });

  it("parses header after disclaimer rows and ingests records", async () => {
    const csv = [
      "DISCLAIMER,This file is provided as is",
      "FOLIO,SITE_ADDR,SITUS_CITY,SITUS_STATE,SITUS_ZIP,OWNER_NAME",
      "0123456789010,100 Main St,Miami,FL,33101,Owner One LLC",
      "0123456789011,200 Main St,Miami,FL,33101,Owner Two LLC",
    ].join("\n");

    const tempFile = path.join(os.tmpdir(), `mdpa-test-${Date.now()}.csv`);
    fs.writeFileSync(tempFile, csv);

    const result = await service.ingest(tempFile, 10);

    expect(result.processed).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.createdDeals).toBe(2);
    expect(prisma.dealOwner.upsert).toHaveBeenCalledTimes(2);

    fs.unlinkSync(tempFile);
  });

  it("skips records without parcel and address", async () => {
    const csv = [
      "FOLIO,SITE_ADDR,SITUS_CITY,SITUS_STATE,SITUS_ZIP,OWNER_NAME",
      ",,Miami,FL,33101,Owner One LLC",
      "0123456789010,100 Main St,Miami,FL,33101,Owner Two LLC",
    ].join("\n");

    const tempFile = path.join(os.tmpdir(), `mdpa-test-${Date.now()}-2.csv`);
    fs.writeFileSync(tempFile, csv);

    const result = await service.ingest(tempFile, 10);

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.createdDeals).toBe(1);

    fs.unlinkSync(tempFile);
  });
});
