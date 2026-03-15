import { Injectable } from "@nestjs/common";
import { PrismaService } from "../shared/prisma.service";

@Injectable()
export class OwnersService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(id: string) {
    return this.prisma.owner.findUnique({ where: { id } });
  }

  async search(query?: string) {
    if (!query) return [];
    return this.prisma.owner.findMany({
      where: { name: { contains: query } },
      take: 50,
    });
  }
}
