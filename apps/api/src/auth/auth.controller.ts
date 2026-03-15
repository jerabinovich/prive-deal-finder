import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { getAuthCookieConfig, readCookie } from "./cookies";
import { Public } from "./public.decorator";
import { JwtUser } from "./jwt.strategy";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService
  ) {}

  @Public()
  @Post("login")
  async login(@Body() body: { email: string }, @Res({ passthrough: true }) res: Response) {
    if (!body?.email?.trim()) {
      throw new BadRequestException("Email is required");
    }

    const auth = await this.authService.login(body.email);
    this.setAuthCookies(res, auth.accessToken, auth.refreshToken);
    return auth;
  }

  @Public()
  @Post("refresh")
  async refresh(
    @Body() body: { refreshToken?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const { refreshCookieName } = getAuthCookieConfig(this.config);
    const refreshToken = body?.refreshToken || readCookie(req.headers.cookie, refreshCookieName) || "";
    const auth = await this.authService.refresh(refreshToken);
    this.setAuthCookies(res, auth.accessToken, auth.refreshToken);
    return auth;
  }

  @Public()
  @Post("logout")
  async logout(@Body() body: { refreshToken?: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { refreshCookieName } = getAuthCookieConfig(this.config);
    const refreshToken = body?.refreshToken || readCookie(req.headers.cookie, refreshCookieName) || "";
    await this.authService.revokeRefreshToken(refreshToken);
    this.clearAuthCookies(res);
    return { success: true };
  }

  @Get("me")
  async me(@Req() req: Request) {
    const user = req.user as JwtUser | undefined;
    if (!user?.sub) {
      throw new UnauthorizedException("Unauthorized");
    }
    return this.authService.me(user.sub);
  }

  @Public()
  @Get("google/status")
  googleStatus() {
    const clientId = this.config.get<string>("GOOGLE_OAUTH_CLIENT_ID", "");
    const clientSecret = this.config.get<string>("GOOGLE_OAUTH_CLIENT_SECRET", "");
    const redirectUri = this.config.get<string>("GOOGLE_OAUTH_REDIRECT_URI", "");
    const missing: string[] = [];
    if (!clientId) missing.push("GOOGLE_OAUTH_CLIENT_ID");
    if (!clientSecret) missing.push("GOOGLE_OAUTH_CLIENT_SECRET");
    if (!redirectUri) missing.push("GOOGLE_OAUTH_REDIRECT_URI");
    if (clientSecret && clientSecret === clientId) {
      missing.push("GOOGLE_OAUTH_CLIENT_SECRET must be different from client id");
    }
    return {
      enabled: missing.length === 0,
      missing,
      redirectUri,
    };
  }

  @Public()
  @Get("google")
  @UseGuards(AuthGuard("google"))
  async googleAuth() {
    return;
  }

  @Public()
  @Get("google/callback")
  @UseGuards(AuthGuard("google"))
  async googleCallback(@Req() req: Request, @Res() res: Response) {
    const email = (req.user as { email?: string } | undefined)?.email;
    if (!email) {
      throw new UnauthorizedException("Google auth failed");
    }

    const auth = await this.authService.login(email);
    this.setAuthCookies(res, auth.accessToken, auth.refreshToken);
    const webUrl = this.config.get<string>("WEB_APP_URL", "http://localhost:3000");
    return res.redirect(`${webUrl}/deals`);
  }

  private setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
    const cookieConfig = getAuthCookieConfig(this.config);
    res.cookie(cookieConfig.accessCookieName, accessToken, cookieConfig.options);
    res.cookie(cookieConfig.refreshCookieName, refreshToken, cookieConfig.options);
  }

  private clearAuthCookies(res: Response) {
    const cookieConfig = getAuthCookieConfig(this.config);
    res.clearCookie(cookieConfig.accessCookieName, cookieConfig.options);
    res.clearCookie(cookieConfig.refreshCookieName, cookieConfig.options);
  }
}
