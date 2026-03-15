import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { AlertsService } from "./alerts.service";
import { AlertInboxQueryDto } from "./dto/alert-inbox-query.dto";
import { CreateAlertRuleDto } from "./dto/create-alert-rule.dto";
import { UpdateAlertRuleDto } from "./dto/update-alert-rule.dto";

@Controller("alerts")
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get("rules")
  async listRules(@Req() req: Request) {
    const user = req.user as { sub?: string } | undefined;
    return this.alertsService.listRules(user?.sub || "");
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Post("rules")
  async createRule(@Req() req: Request, @Body() body: CreateAlertRuleDto) {
    const user = req.user as { sub?: string } | undefined;
    return this.alertsService.createRule(user?.sub || "", body);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Patch("rules/:id")
  async updateRule(@Req() req: Request, @Param("id") id: string, @Body() body: UpdateAlertRuleDto) {
    const user = req.user as { sub?: string } | undefined;
    return this.alertsService.updateRule(user?.sub || "", id, body);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get("inbox")
  async inbox(@Req() req: Request, @Query() query: AlertInboxQueryDto) {
    const user = req.user as { sub?: string } | undefined;
    return this.alertsService.listInbox(user?.sub || "", query);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Post("inbox/:id/read")
  async markRead(@Req() req: Request, @Param("id") id: string) {
    const user = req.user as { sub?: string } | undefined;
    return this.alertsService.markInboxRead(user?.sub || "", id);
  }

  @Roles("ADMIN")
  @Post("digest/run")
  async runDigest() {
    return this.alertsService.runDigest();
  }
}
