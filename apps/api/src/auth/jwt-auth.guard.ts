import { ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthGuard } from "@nestjs/passport";
import { IS_PUBLIC_KEY } from "./public.decorator";

/**
 * Rutas donde se acepta `x-api-key` ADEMAS del JWT de usuario.
 *
 * POR QUE. El commit C6 (8-sep) cerro el login por email en el cuerpo: ahora
 * /auth/login exige la cabecera de Cloudflare Access. Correcto — pero de paso
 * dejo muerto al runner automatico (prive-deal-finder-ops/morning_refresh.js,
 * el cron de las 8am), que se logueaba con SMOKE_EMAIL para disparar los syncs.
 *
 * La palanca que dejo el propio C6 es AUTH_ALLOW_BODY_EMAIL=true, pero eso
 * reabre el agujero entero: cualquiera que llegue a :4000 se loguea como quien
 * quiera. Esto es lo minimo que hace falta en su lugar — una identidad de
 * maquina, con una clave que YA existia (DEAL_FINDER_API_KEY, hoy usada por
 * /agent/*), y SOLO sobre las rutas que el cron necesita.
 *
 * La lista es explicita a proposito: la clave NO abre el resto de la API. Si
 * manana hace falta otra ruta, se agrega aca y se ve en el diff.
 */
const API_KEY_ROUTES: Array<{ method: string; pattern: RegExp }> = [
  { method: "POST", pattern: /^\/api\/integrations\/[^/]+\/sync\/?$/ },
  { method: "GET", pattern: /^\/api\/integrations\/status\/?$/ },
  { method: "GET", pattern: /^\/api\/integrations\/runs\/?$/ },
  // Ultimo paso del mismo cron: enriquece los deals recien ingeridos.
  { method: "POST", pattern: /^\/api\/deals\/backfill-facts\/?$/ },
];

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    if (this.isServiceAccountRequest(context)) {
      return true;
    }

    return super.canActivate(context);
  }

  /** Solo para las rutas de API_KEY_ROUTES y solo con la clave exacta del servidor. */
  private isServiceAccountRequest(context: ExecutionContext): boolean {
    const expected = process.env.DEAL_FINDER_API_KEY?.trim();
    if (!expected) return false;

    const req = context.switchToHttp().getRequest();
    const incoming = req?.headers?.["x-api-key"];
    if (typeof incoming !== "string" || incoming !== expected) return false;

    const method = String(req.method || "").toUpperCase();
    const path = String(req.originalUrl || req.url || "").split("?")[0];
    const allowed = API_KEY_ROUTES.some((r) => r.method === method && r.pattern.test(path));
    if (!allowed) {
      this.logger.warn(`x-api-key valida pero la ruta no esta habilitada: ${method} ${path}`);
      return false;
    }

    // RolesGuard corre despues y el sync exige ADMIN: la cuenta de servicio lo
    // necesita para que el cron pueda disparar la ingesta.
    req.user = { id: "service-account", email: "service@privegroup.com", role: "ADMIN" };
    return true;
  }
}
