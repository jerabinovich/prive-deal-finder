import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { ChatQueryDto } from "./dto/chat-query.dto";
import { ChatSuggestFiltersDto } from "./dto/chat-suggest-filters.dto";
import { ChatService } from "./chat.service";

@Controller("chat")
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Post("query")
  async query(@Req() req: Request, @Body() body: ChatQueryDto) {
    const user = req.user as { sub?: string } | undefined;
    return this.chatService.query(user?.sub || "", body);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get("context/:dealId")
  async context(@Req() req: Request, @Param("dealId") dealId: string) {
    const user = req.user as { sub?: string } | undefined;
    return this.chatService.getContext(user?.sub || "", dealId);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Post("suggest-filters")
  async suggestFilters(@Req() req: Request, @Body() body: ChatSuggestFiltersDto) {
    const user = req.user as { sub?: string } | undefined;
    return this.chatService.suggestFilters(user?.sub || "", body);
  }
}
