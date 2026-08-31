import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { ApiKeyGuard } from "../auth/guards/api-key.guard";
import { DealsService } from "../deals/deals.service";
import { PrismaService } from "../shared/prisma.service";

@Public()
@UseGuards(ApiKeyGuard)
@Controller("agent")
export class AgentDealsController {
  constructor(
    private readonly deals: DealsService,
    private readonly prisma: PrismaService,
  ) {}

  /** GET /api/agent/deals?search=&status=&limit=&page= */
  @Get("deals")
  list(@Query() query: Record<string, any>) {
    const p: Record<string, any> = { ...query };
    for (const k of ["limit", "page", "skip", "take"]) {
      if (p[k] !== undefined) p[k] = Number(p[k]) || undefined;
    }
    return this.deals.list(p as any);
  }

  /** POST /api/agent/deals */
  @Post("deals")
  create(@Body() body: Record<string, any>) {
    return this.deals.create(body as any);
  }

  /** PUT /api/agent/deals/:id/status  — body: { "status": "ACTIVE" } */
  @Put("deals/:id/status")
  updateStatus(
    @Param("id") id: string,
    @Body() body: { status: string },
  ) {
    return this.deals.update(id, { status: body.status } as any);
  }

  /** POST /api/agent/deals/:id/notes  — body: { "note": "...", "source": "amanda" } */
  @Post("deals/:id/notes")
  addNote(
    @Param("id") id: string,
    @Body() body: { note: string; source?: string },
  ) {
    return this.prisma.dealEvent.create({
      data: {
        dealId:    id,
        eventType: "AGENT_NOTE",
        eventDate: new Date(),
        source:    body.source ?? "amanda",
        reference: body.note,
      },
    });
  }
}
