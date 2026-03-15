import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "./auth.service";

describe("AuthService", () => {
  const configValues: Record<string, string> = {
    JWT_SECRET: "unit_test_jwt_secret_123456",
    JWT_EXPIRES_IN: "1d",
    JWT_REFRESH_SECRET: "unit_test_refresh_secret_123456",
    JWT_REFRESH_EXPIRES_IN: "7d",
    AUTH_ADMIN_EMAILS: "admin@privegroup.com",
  };

  const config = {
    get: jest.fn((key: string, fallback?: string) => configValues[key] ?? fallback),
  } as unknown as ConfigService;

  const prisma = {
    user: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  } as any;

  const jwtService = new JwtService({ secret: configValues.JWT_SECRET });
  const service = new AuthService(prisma, jwtService, config);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue(null);
  });

  it("login returns access + refresh tokens and user", async () => {
    prisma.user.upsert.mockResolvedValue({
      id: "user-1",
      email: "jr@privegroup.com",
      role: "ANALYST",
      createdAt: new Date(),
      lastLoginAt: new Date(),
    });
    prisma.refreshToken.create.mockResolvedValue({ id: "rt-1" });

    const auth = await service.login("jr@privegroup.com");

    expect(auth.accessToken).toBeTruthy();
    expect(auth.refreshToken).toBeTruthy();
    expect(auth.user.email).toBe("jr@privegroup.com");
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it("refresh rejects unknown refresh token", async () => {
    const refreshToken = await jwtService.signAsync(
      {
        sub: "user-1",
        email: "jr@privegroup.com",
        role: "ANALYST",
        type: "refresh",
      },
      {
        secret: configValues.JWT_REFRESH_SECRET,
        expiresIn: "7d",
      }
    );

    prisma.refreshToken.findFirst.mockResolvedValue(null);

    await expect(service.refresh(refreshToken)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("me returns current user", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "jr@privegroup.com",
      role: "ANALYST",
      createdAt: new Date(),
      lastLoginAt: new Date(),
    });

    const me = await service.me("user-1");

    expect(me).toEqual({ id: "user-1", email: "jr@privegroup.com", role: "ANALYST" });
  });

  it("login promotes configured admin email", async () => {
    prisma.user.upsert.mockResolvedValue({
      id: "admin-1",
      email: "admin@privegroup.com",
      role: "ADMIN",
      createdAt: new Date(),
      lastLoginAt: new Date(),
    });
    prisma.refreshToken.create.mockResolvedValue({ id: "rt-2" });

    const auth = await service.login("admin@privegroup.com");

    expect(auth.user.role).toBe("ADMIN");
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ role: "ADMIN" }),
        create: expect.objectContaining({ role: "ADMIN" }),
      })
    );
  });
});
