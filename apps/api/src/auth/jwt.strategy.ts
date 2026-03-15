import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { Request } from "express";
import { getAuthCookieConfig, readCookie } from "./cookies";

export interface JwtUser {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(config: ConfigService) {
    const { accessCookieName } = getAuthCookieConfig(config);
    const accessTokenFromCookie = (req: Request) => readCookie(req?.headers?.cookie, accessCookieName) ?? null;

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([accessTokenFromCookie, ExtractJwt.fromAuthHeaderAsBearerToken()]),
      ignoreExpiration: false,
      secretOrKey: config.get<string>("JWT_SECRET", "change_me"),
    });
  }

  async validate(payload: JwtUser): Promise<JwtUser> {
    return payload;
  }
}
