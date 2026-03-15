import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "crypto";
import { PrismaService } from "../shared/prisma.service";

export interface AuthUser {
  id: string;
  email: string;
  role: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

type UserRole = "ADMIN" | "ANALYST" | "PARTNER";

interface DbUser {
  id: string;
  email: string;
  role: UserRole;
}

interface RefreshPayload {
  sub: string;
  email: string;
  role: string;
  type: "refresh";
  jti?: string;
  exp?: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService
  ) {}

  async login(email: string): Promise<AuthResponse> {
    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = (await this.prisma.user.findUnique({ where: { email: normalizedEmail } })) as
      | (DbUser & { lastLoginAt?: Date | null })
      | null;
    const role = this.resolveRole(normalizedEmail, existingUser?.role);
    const user = (await this.prisma.user.upsert({
      where: { email: normalizedEmail },
      update: { lastLoginAt: new Date(), role },
      create: { email: normalizedEmail, role },
    })) as DbUser;
    return this.issueTokens(user);
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    if (!refreshToken?.trim()) {
      throw new UnauthorizedException("Refresh token is required");
    }

    let payload: RefreshPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.getRefreshSecret(),
      });
    } catch (_error) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    if (payload.type !== "refresh") {
      throw new UnauthorizedException("Invalid refresh token type");
    }

    const tokenHash = this.hashToken(refreshToken);
    const tokenRecord = await this.prisma.refreshToken.findFirst({
      where: {
        tokenHash,
        userId: payload.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException("Refresh token not recognized");
    }

    await this.prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(tokenRecord.user);
  }

  async me(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException("User not found");
    }
    return this.toAuthUser(user);
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    const normalized = refreshToken?.trim();
    if (!normalized) return;

    await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash: this.hashToken(normalized),
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(user: DbUser): Promise<AuthResponse> {
    const userPayload = { sub: user.id, email: user.email, role: user.role };

    const accessToken = await this.jwtService.signAsync(userPayload, {
      secret: this.config.get<string>("JWT_SECRET", "change_me"),
      expiresIn: this.config.get<string>("JWT_EXPIRES_IN", "1d"),
    });

    const refreshToken = await this.jwtService.signAsync(
      {
        ...userPayload,
        type: "refresh",
        jti: randomUUID(),
      },
      {
        secret: this.getRefreshSecret(),
        expiresIn: this.config.get<string>("JWT_REFRESH_EXPIRES_IN", "7d"),
      }
    );

    const verified = await this.jwtService.verifyAsync<RefreshPayload>(refreshToken, {
      secret: this.getRefreshSecret(),
    });

    const expiresAt = verified.exp ? new Date(verified.exp * 1000) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      user: this.toAuthUser(user),
    };
  }

  private getRefreshSecret() {
    return this.config.get<string>("JWT_REFRESH_SECRET") || this.config.get<string>("JWT_SECRET", "change_me");
  }

  private resolveRole(email: string, existingRole?: UserRole): UserRole {
    const admins = this.config
      .get<string>("AUTH_ADMIN_EMAILS", "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);

    if (admins.includes(email)) {
      return "ADMIN";
    }

    return existingRole ?? "ANALYST";
  }

  private hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private toAuthUser(user: DbUser): AuthUser {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  }
}
