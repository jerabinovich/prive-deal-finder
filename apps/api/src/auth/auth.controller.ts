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

/**
 * Solo se confia en la cabecera de Cloudflare Access si la peticion entro por loopback, que es por
 * donde la entrega cloudflared. Cualquiera que hable directo con el puerto puede inventar la
 * cabecera; nadie de afuera puede inventar la IP de origen.
 */
export function isLoopbackRequest(req: Request): boolean {
  const ip = (req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
  return ip === "127.0.0.1" || ip === "::1";
}

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService
  ) {}

  // ── C6 (8-sep-2026): el cuerpo deja de ser fuente de identidad ──────────────────────────
  // RAIZ: este endpoint aceptaba {email} del cuerpo, sin password, y authService.login promueve
  // a ADMIN a cualquier email que este en AUTH_ADMIN_EMAILS. Se decia que el perimetro real era
  // Cloudflare Access, y eso es cierto SOLO para el camino publico. MEDIDO el 8-sep: la API
  // escucha en *:4000, no en loopback, asi que cualquier equipo del tailnet llega directo y
  // Cloudflare no participa. Probado desde otra maquina del tailnet: /api/health devuelve 200.
  //
  // POR QUE NO ALCANZA CON LEER LA CABECERA. Cf-Access-Authenticated-User-Email la puede escribir
  // cualquiera que hable directo con el puerto. Por eso la cabecera se cree UNICAMENTE si la
  // peticion entro por loopback, que es por donde entra cloudflared (corre en esta misma maquina).
  // Una peticion directa del tailnet tiene IP de tailnet y se rechaza aunque traiga la cabecera.
  //
  // LO QUE TODAVIA FALTA, dicho explicitamente para que no parezca cerrado: lo correcto de verdad
  // es validar el JWT Cf-Access-Jwt-Assertion contra las claves publicas de Access. Esto es la
  // capa de red, que es la que hoy esta abierta; la de firma queda anotada como siguiente paso.
  //
  // PALANCA DE VUELTA: AUTH_ALLOW_BODY_EMAIL=true en el .env restaura el comportamiento anterior
  // sin tocar codigo ni redeployar nada mas que un restart. No es la configuracion normal.
  @Public()
  @Post("login")
  async login(
    @Body() body: { email?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    const auth = await this.authService.login(this.resolveLoginEmail(req, body));
    this.setAuthCookies(res, auth.accessToken, auth.refreshToken);
    return auth;
  }

  /** Decide de donde sale la identidad del login. Pura salvo por leer config. */
  private resolveLoginEmail(req: Request, body?: { email?: string }): string {
    const raw = req.headers["cf-access-authenticated-user-email"];
    const cfEmail = (Array.isArray(raw) ? raw[0] : raw || "").trim();
    if (cfEmail && isLoopbackRequest(req)) {
      return cfEmail;
    }

    const allowBody =
      String(this.config.get<string>("AUTH_ALLOW_BODY_EMAIL", "")).trim().toLowerCase() === "true";
    if (allowBody) {
      const bodyEmail = (body?.email || "").trim();
      if (!bodyEmail) {
        throw new BadRequestException("Email is required");
      }
      return bodyEmail;
    }

    throw new UnauthorizedException(
      "Login must arrive through Cloudflare Access. Use /auth/google, or set AUTH_ALLOW_BODY_EMAIL=true to restore the previous behavior."
    );
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
