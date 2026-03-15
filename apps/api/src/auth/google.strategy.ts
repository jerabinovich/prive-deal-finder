import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { Strategy, VerifyCallback } from "passport-google-oauth20";

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, "google") {
  constructor(private readonly config: ConfigService) {
    super({
      clientID: config.get<string>("GOOGLE_OAUTH_CLIENT_ID", ""),
      clientSecret: config.get<string>("GOOGLE_OAUTH_CLIENT_SECRET", ""),
      callbackURL: config.get<string>("GOOGLE_OAUTH_REDIRECT_URI", ""),
      scope: ["email", "profile"],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback
  ) {
    const email = profile?.emails?.[0]?.value;
    done(null, { email });
  }
}
