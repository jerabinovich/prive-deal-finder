import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../shared/prisma.service";
import { AlertInboxQueryDto } from "./dto/alert-inbox-query.dto";
import { CreateAlertRuleDto } from "./dto/create-alert-rule.dto";
import { UpdateAlertRuleDto } from "./dto/update-alert-rule.dto";

function parseJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch (_error) {
    return null;
  }
}

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  async listRules(userId: string) {
    const rules = await this.prisma.alertRule.findMany({
      where: { userId },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
    });
    return rules.map((rule) => ({
      id: rule.id,
      userId: rule.userId,
      triggerType: rule.triggerType,
      market: rule.market,
      lane: rule.lane,
      active: rule.active,
      delivery: rule.delivery,
      config: parseJson(rule.configJson),
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    }));
  }

  async createRule(userId: string, input: CreateAlertRuleDto) {
    const row = await this.prisma.alertRule.create({
      data: {
        userId,
        triggerType: input.triggerType.trim(),
        market: input.market?.trim() || null,
        lane: (input.lane as Prisma.AlertRuleCreateInput["lane"]) ?? null,
        active: input.active ?? true,
        delivery: (input.delivery as Prisma.AlertRuleCreateInput["delivery"]) ?? "IN_APP",
        configJson: input.config ? JSON.stringify(input.config) : null,
      },
    });

    return {
      id: row.id,
      userId: row.userId,
      triggerType: row.triggerType,
      market: row.market,
      lane: row.lane,
      active: row.active,
      delivery: row.delivery,
      config: parseJson(row.configJson),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async updateRule(userId: string, ruleId: string, input: UpdateAlertRuleDto) {
    const existing = await this.prisma.alertRule.findFirst({
      where: { id: ruleId, userId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException("Alert rule not found");

    const row = await this.prisma.alertRule.update({
      where: { id: ruleId },
      data: {
        triggerType: input.triggerType?.trim(),
        market: input.market === undefined ? undefined : (input.market?.trim() || null),
        lane: input.lane === undefined ? undefined : (input.lane as Prisma.AlertRuleUpdateInput["lane"]),
        active: input.active,
        delivery: input.delivery as Prisma.AlertRuleUpdateInput["delivery"] | undefined,
        configJson: input.config === undefined ? undefined : (input.config ? JSON.stringify(input.config) : null),
      },
    });

    return {
      id: row.id,
      userId: row.userId,
      triggerType: row.triggerType,
      market: row.market,
      lane: row.lane,
      active: row.active,
      delivery: row.delivery,
      config: parseJson(row.configJson),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listInbox(userId: string, query: AlertInboxQueryDto) {
    const where: Prisma.AlertInboxItemWhereInput = {
      userId,
      ...(query.unreadOnly ? { readAt: null } : {}),
    };

    const rows = await this.prisma.alertInboxItem.findMany({
      where,
      include: {
        alertEvent: {
          include: {
            deal: {
              select: { id: true, name: true, market: true, lane: true, recommendedAction: true },
            },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
      take: query.limit ?? 50,
      skip: query.offset ?? 0,
    });

    const total = await this.prisma.alertInboxItem.count({ where });

    return {
      total,
      items: rows.map((item) => ({
        id: item.id,
        userId: item.userId,
        readAt: item.readAt?.toISOString() ?? null,
        deliveredAt: item.deliveredAt?.toISOString() ?? null,
        channel: item.channel,
        createdAt: item.createdAt.toISOString(),
        alertEvent: {
          id: item.alertEvent.id,
          dealId: item.alertEvent.dealId,
          triggerType: item.alertEvent.triggerType,
          severity: item.alertEvent.severity,
          eventAt: item.alertEvent.eventAt.toISOString(),
          payload: parseJson(item.alertEvent.payloadJson),
          createdAt: item.alertEvent.createdAt.toISOString(),
          deal: item.alertEvent.deal
            ? {
                id: item.alertEvent.deal.id,
                name: item.alertEvent.deal.name,
                market: item.alertEvent.deal.market,
                lane: item.alertEvent.deal.lane,
                recommendedAction: item.alertEvent.deal.recommendedAction,
              }
            : null,
        },
      })),
    };
  }

  async markInboxRead(userId: string, inboxId: string) {
    const existing = await this.prisma.alertInboxItem.findFirst({
      where: { id: inboxId, userId },
      select: { id: true, readAt: true },
    });
    if (!existing) throw new NotFoundException("Inbox item not found");

    const row = await this.prisma.alertInboxItem.update({
      where: { id: inboxId },
      data: {
        readAt: existing.readAt ?? new Date(),
      },
    });

    return {
      id: row.id,
      readAt: row.readAt?.toISOString() ?? null,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
    };
  }

  async runDigest() {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const rules = await this.prisma.alertRule.findMany({
      where: { active: true, delivery: "DIGEST_DAILY" },
      select: { id: true, userId: true, triggerType: true, market: true, lane: true },
    });
    if (!rules.length) {
      return { processedRules: 0, createdInboxItems: 0, reason: "No active digest rules." };
    }

    let createdInboxItems = 0;
    for (const rule of rules) {
      const events = await this.prisma.alertEvent.findMany({
        where: {
          triggerType: rule.triggerType,
          eventAt: { gte: dayAgo },
          ...(rule.market || rule.lane
            ? {
                deal: {
                  ...(rule.market ? { market: rule.market } : {}),
                  ...(rule.lane ? { lane: rule.lane } : {}),
                },
              }
            : {}),
        },
        orderBy: [{ eventAt: "desc" }],
        take: 200,
      });

      for (const event of events) {
        const row = await this.prisma.alertInboxItem.upsert({
          where: { userId_alertEventId: { userId: rule.userId, alertEventId: event.id } },
          update: {
            deliveredAt: now,
            channel: "DIGEST_DAILY",
          },
          create: {
            userId: rule.userId,
            alertEventId: event.id,
            deliveredAt: now,
            channel: "DIGEST_DAILY",
          },
        });
        if (row.createdAt.getTime() >= now.getTime() - 1000) createdInboxItems += 1;
      }
    }

    return {
      processedRules: rules.length,
      createdInboxItems,
      generatedAt: now.toISOString(),
    };
  }
}
