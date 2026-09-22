import { NotFoundException } from "@nestjs/common";
import { DealsService } from "./deals.service";

describe("DealsService.getRecordedDebt", () => {
  it("devuelve la ultima deuda registrada del folio y no escribe nada", async () => {
    const payload = JSON.stringify({ schemaVersion: 1, folio: "3031210000490", outcome: "NO_RECORDS" });
    const prisma: any = {
      deal: { findUnique: jest.fn(async () => ({ parcelId: "3031210000490", market: "Miami-Dade" })), update: jest.fn() },
      stagingRecord: { findFirst: jest.fn(async () => ({ payload, receivedAt: new Date("2026-09-22T16:00:00Z") })), create: jest.fn() },
    };
    const view = await new DealsService(prisma).getRecordedDebt("deal-1");
    expect(view).toEqual(expect.objectContaining({ available: true, informationalOnly: true, folio: "3031210000490" }));
    expect(prisma.stagingRecord.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { source: "miami-dade-clerk", sourceRecordId: "3031210000490" } }),
    );
    expect(prisma.deal.update).not.toHaveBeenCalled();
    expect(prisma.stagingRecord.create).not.toHaveBeenCalled();
  });

  it("404 si el deal no existe", async () => {
    const prisma: any = { deal: { findUnique: jest.fn(async () => null) } };
    await expect(new DealsService(prisma).getRecordedDebt("nope")).rejects.toBeInstanceOf(NotFoundException);
  });
});
