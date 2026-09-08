/**
 * C6 (8-sep-2026): de donde sale la identidad en POST /auth/login.
 *
 * El caso que importa y que motivo el cambio: la API escucha en *:4000, asi que una peticion
 * directa del tailnet no pasa por Cloudflare. Esa peticion puede INVENTAR la cabecera
 * Cf-Access-Authenticated-User-Email. Por eso la cabecera solo vale si entro por loopback.
 */
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { AuthController, isLoopbackRequest } from "./auth.controller";

type Cfg = Record<string, string>;

function mkController(cfg: Cfg = {}): AuthController {
  const config = { get: (k: string, def = "") => (k in cfg ? cfg[k] : def) };
  return new AuthController({} as never, config as never);
}

function mkReq(ip: string, headers: Record<string, string> = {}): Request {
  return { ip, socket: { remoteAddress: ip }, headers } as unknown as Request;
}

// resolveLoginEmail es privado a proposito; el test lo alcanza por el nombre, que es lo que
// se quiere fijar: el comportamiento, no la firma publica.
const resolver = (c: AuthController) =>
  (req: Request, body?: { email?: string }) =>
    (c as unknown as { resolveLoginEmail(r: Request, b?: { email?: string }): string })
      .resolveLoginEmail(req, body);

describe("isLoopbackRequest", () => {
  it("reconoce loopback en sus tres formas", () => {
    expect(isLoopbackRequest(mkReq("127.0.0.1"))).toBe(true);
    expect(isLoopbackRequest(mkReq("::1"))).toBe(true);
    expect(isLoopbackRequest(mkReq("::ffff:127.0.0.1"))).toBe(true);
  });
  it("no confunde una IP del tailnet con loopback", () => {
    expect(isLoopbackRequest(mkReq("100.108.120.120"))).toBe(false);
    expect(isLoopbackRequest(mkReq("172.17.0.1"))).toBe(false);
  });
});

describe("resolveLoginEmail", () => {
  const CF = "cf-access-authenticated-user-email";

  it("acepta la cabecera de Access cuando entra por loopback (el camino de cloudflared)", () => {
    const r = resolver(mkController());
    expect(r(mkReq("127.0.0.1", { [CF]: "jr@privegroup.com" }))).toBe("jr@privegroup.com");
  });

  it("EL CASO: rechaza la cabecera inventada desde el tailnet", () => {
    const r = resolver(mkController());
    expect(() => r(mkReq("100.108.120.120", { [CF]: "jr@privegroup.com" })))
      .toThrow(UnauthorizedException);
  });

  it("rechaza el email del cuerpo, que era el agujero", () => {
    const r = resolver(mkController());
    expect(() => r(mkReq("100.108.120.120"), { email: "jr@privegroup.com" }))
      .toThrow(UnauthorizedException);
    expect(() => r(mkReq("127.0.0.1"), { email: "jr@privegroup.com" }))
      .toThrow(UnauthorizedException);
  });

  it("la cabecera le gana al cuerpo", () => {
    const r = resolver(mkController());
    expect(r(mkReq("127.0.0.1", { [CF]: "real@privegroup.com" }), { email: "otro@ejemplo.com" }))
      .toBe("real@privegroup.com");
  });

  it("la palanca de vuelta restaura el comportamiento anterior", () => {
    const r = resolver(mkController({ AUTH_ALLOW_BODY_EMAIL: "true" }));
    expect(r(mkReq("100.108.120.120"), { email: "jr@privegroup.com" })).toBe("jr@privegroup.com");
    expect(() => r(mkReq("100.108.120.120"), { email: "   " })).toThrow(BadRequestException);
  });

  it("la palanca solo se activa con el literal true", () => {
    for (const v of ["1", "yes", "TRUE ", "si", ""]) {
      const r = resolver(mkController({ AUTH_ALLOW_BODY_EMAIL: v }));
      const esperaAbierto = v.trim().toLowerCase() === "true";
      if (esperaAbierto) {
        expect(r(mkReq("10.0.0.5"), { email: "a@b.com" })).toBe("a@b.com");
      } else {
        expect(() => r(mkReq("10.0.0.5"), { email: "a@b.com" })).toThrow(UnauthorizedException);
      }
    }
  });
});
