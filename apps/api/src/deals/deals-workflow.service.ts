import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../shared/prisma.service";
import { CreateWorkflowTaskDto } from "./dto/create-workflow-task.dto";
import { UpdateWorkflowTaskDto } from "./dto/update-workflow-task.dto";
import { parseJson } from "./deals.utils";

@Injectable()
export class DealsWorkflowService {
  constructor(private readonly prisma: PrismaService) {}

  async getWorkflow(dealId: string) {
    const deal = await this.prisma.deal.findUnique({
      where: { id: dealId },
      select: { id: true, lane: true, recommendedAction: true, distressStage: true },
    });
    if (!deal) throw new NotFoundException("Deal not found");

    const tasks = await this.prisma.dealWorkflowTask.findMany({
      where: { dealId },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });

    return {
      dealId,
      lane: deal.lane,
      recommendedAction: deal.recommendedAction,
      distressStage: deal.distressStage,
      tasks: tasks.map((task) => ({
        id: task.id, lane: task.lane, taskType: task.taskType, title: task.title,
        description: task.description, priority: task.priority, status: task.status,
        dueAt: task.dueAt?.toISOString() ?? null, ownerUserId: task.ownerUserId ?? null,
        source: task.source, metadata: parseJson<Record<string, unknown>>(task.metadata),
        createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
      })),
    };
  }

  async createWorkflowTask(dealId: string, input: CreateWorkflowTaskDto) {
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId }, select: { id: true } });
    if (!deal) throw new NotFoundException("Deal not found");

    const row = await this.prisma.dealWorkflowTask.create({
      data: {
        dealId,
        lane: (input.lane as Prisma.DealWorkflowTaskCreateInput["lane"]) ?? null,
        taskType: input.taskType.trim(), title: input.title.trim(),
        description: input.description?.trim() || null,
        priority: input.priority ?? 3,
        status: (input.status as Prisma.DealWorkflowTaskCreateInput["status"]) ?? "TODO",
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        ownerUserId: input.ownerUserId ?? null,
        source: (input.source as Prisma.DealWorkflowTaskCreateInput["source"]) ?? "USER",
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      },
    });

    return this.formatTask(row);
  }

  async updateWorkflowTask(dealId: string, taskId: string, input: UpdateWorkflowTaskDto) {
    const existing = await this.prisma.dealWorkflowTask.findFirst({ where: { id: taskId, dealId }, select: { id: true } });
    if (!existing) throw new NotFoundException("Workflow task not found");

    const row = await this.prisma.dealWorkflowTask.update({
      where: { id: taskId },
      data: {
        lane: input.lane === undefined ? undefined : (input.lane as Prisma.DealWorkflowTaskUpdateInput["lane"]),
        title: input.title?.trim(),
        description: input.description === undefined ? undefined : (input.description?.trim() || null),
        priority: input.priority,
        status: input.status as Prisma.DealWorkflowTaskUpdateInput["status"] | undefined,
        dueAt: input.dueAt === undefined ? undefined : (input.dueAt ? new Date(input.dueAt) : null),
        ownerUserId: input.ownerUserId === undefined ? undefined : input.ownerUserId,
        source: input.source as Prisma.DealWorkflowTaskUpdateInput["source"] | undefined,
        metadata: input.metadata === undefined ? undefined : (input.metadata ? JSON.stringify(input.metadata) : null),
      },
    });

    return this.formatTask(row);
  }

  private formatTask(row: Awaited<ReturnType<typeof this.prisma.dealWorkflowTask.create>>) {
    return {
      id: row.id, dealId: row.dealId, lane: row.lane, taskType: row.taskType, title: row.title,
      description: row.description, priority: row.priority, status: row.status,
      dueAt: row.dueAt?.toISOString() ?? null, ownerUserId: row.ownerUserId ?? null,
      source: row.source, metadata: parseJson<Record<string, unknown>>(row.metadata),
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }
}
