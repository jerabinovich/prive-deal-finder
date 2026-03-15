import { Controller, Get, Param, Query } from "@nestjs/common";
import { OwnersService } from "./owners.service";
import { Roles } from "../auth/roles.decorator";

@Controller("owners")
export class OwnersController {
  constructor(private readonly ownersService: OwnersService) {}

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get(":id")
  async get(@Param("id") id: string) {
    return this.ownersService.getById(id);
  }

  @Roles("ADMIN", "ANALYST", "PARTNER")
  @Get()
  async search(@Query("search") search?: string) {
    return this.ownersService.search(search);
  }
}
