import { Injectable } from "@nestjs/common";
import { PrismaService } from "../shared/prisma.service";

@Injectable()
export class OutreachService {
  constructor(private readonly prisma: PrismaService) {}

  async generateEmailTemplate(dealId: string) {
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal) return null;
    const subject = `Regarding ${deal.name}`;
    const body = `Hello,\n\nWe are reviewing ${deal.name} located at ${deal.address ?? ""}. ` +
      `We would like to discuss a potential opportunity.\n\nThanks,\nPrive Group`;
    return { subject, body };
  }

  async generateSmsTemplate(dealId: string) {
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal) return null;
    const body = `Hi, interested in discussing ${deal.name}. Can we schedule a quick call?`;
    return { body };
  }

  async logOutreach(params: {
    dealId: string;
    channel: "EMAIL" | "SMS" | "NOTE";
    recipient?: string;
    subject?: string;
    body?: string;
    status?: string;
    sentAt?: Date;
  }) {
    return this.prisma.outreachLog.create({
      data: {
        dealId: params.dealId,
        channel: params.channel,
        recipient: params.recipient,
        subject: params.subject,
        body: params.body,
        status: params.status,
        sentAt: params.sentAt,
      },
    });
  }
}
