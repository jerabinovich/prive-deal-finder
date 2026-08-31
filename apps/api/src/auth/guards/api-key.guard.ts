import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const incoming = req.headers["x-api-key"];
    const expected = process.env.DEAL_FINDER_API_KEY;

    if (!expected) {
      throw new UnauthorizedException("DEAL_FINDER_API_KEY not configured on server");
    }
    if (!incoming || incoming !== expected) {
      throw new UnauthorizedException("Invalid or missing x-api-key header");
    }
    return true;
  }
}
