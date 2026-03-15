import { Body, Controller, Param, Post } from "@nestjs/common";
import { OutreachService } from "./outreach.service";
import { Roles } from "../auth/roles.decorator";

@Controller("deals/:id/outreach")
export class OutreachController {
  constructor(private readonly outreachService: OutreachService) {}

  @Roles("ADMIN", "ANALYST")
  @Post("email-template")
  async emailTemplate(@Param("id") id: string) {
    return this.outreachService.generateEmailTemplate(id);
  }

  @Roles("ADMIN", "ANALYST")
  @Post("sms-template")
  async smsTemplate(@Param("id") id: string) {
    return this.outreachService.generateSmsTemplate(id);
  }

  @Roles("ADMIN", "ANALYST")
  @Post("log")
  async log(
    @Param("id") id: string,
    @Body() body: { channel: "EMAIL" | "SMS" | "NOTE"; recipient?: string; subject?: string; message?: string }
  ) {
    return this.outreachService.logOutreach({
      dealId: id,
      channel: body.channel,
      recipient: body.recipient,
      subject: body.subject,
      body: body.message,
      status: "LOGGED",
      sentAt: new Date(),
    });
  }
}
