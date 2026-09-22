/**
 * C6 (8-sep-2026): de donde sale la identidad en POST /auth/login.
 *
 * El caso que importa y que motivo el cambio: la API escucha en *:4000, asi que una peticion
 * directa del tailnet no pasa por Cloudflare. Esa peticion puede INVENTAR la cabecera
 * Cf-Access-Authenticated-User-Email. Por eso la cabecera solo vale si entro por loopback.
 */
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { AuthController, arrivedThroughCloudflare, isLoopbackRequest } from "./auth.controller";

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

  describe("modo loopback (22-sep-2026: acceso por tunel ssh)", () => {
    const loop = () => resolver(mkController({ AUTH_ALLOW_BODY_EMAIL: "loopback" }));

    it("acepta el correo del cuerpo si entra por loopback, que es lo que hace el tunel", () => {
      expect(loop()(mkReq("127.0.0.1"), { email: "jr@privegroup.com" })).toBe("jr@privegroup.com");
      expect(loop()(mkReq("::1"), { email: "jr@privegroup.com" })).toBe("jr@privegroup.com");
      expect(loop()(mkReq("::ffff:127.0.0.1"), { email: "jr@privegroup.com" })).toBe("jr@privegroup.com");
    });

    it("sigue rechazando el cuerpo desde el tailnet, la red local o un contenedor en bridge", () => {
      for (const ip of ["100.108.120.120", "10.1.10.109", "172.17.0.2"]) {
        expect(() => loop()(mkReq(ip), { email: "jr@privegroup.com" })).toThrow(UnauthorizedException);
      }
    });

    it("rechaza el cuerpo si lo trajo cloudflared aunque llegue por loopback", () => {
      const casos: Array<Record<string, string>> = [{ "cf-ray": "8c1f2a3b4c5d6e7f-MIA" }, { "cf-connecting-ip": "203.0.113.9" }];
      for (const h of casos) {
        expect(() => loop()(mkReq("127.0.0.1", h), { email: "jr@privegroup.com" })).toThrow(UnauthorizedException);
      }
    });

    it("la cabecera de Access le sigue ganando al cuerpo", () => {
      const CF_EMAIL = "cf-access-authenticated-user-email";
      expect(loop()(mkReq("127.0.0.1", { [CF_EMAIL]: "real@privegroup.com", "cf-ray": "x" }), { email: "otro@ejemplo.com" }))
        .toBe("real@privegroup.com");
    });

    it("un correo vacio por loopback es un pedido mal formado, no un login", () => {
      expect(() => loop()(mkReq("127.0.0.1"), { email: "  " })).toThrow(BadRequestException);
    });

    it("solo el literal loopback activa el modo", () => {
      for (const v of ["loop", "local", "127.0.0.1", "LOOPBACK "]) {
        const r = resolver(mkController({ AUTH_ALLOW_BODY_EMAIL: v }));
        if (v.trim().toLowerCase() === "loopback") {
          expect(r(mkReq("127.0.0.1"), { email: "a@b.com" })).toBe("a@b.com");
        } else {
          expect(() => r(mkReq("127.0.0.1"), { email: "a@b.com" })).toThrow(UnauthorizedException);
        }
      }
    });

    it("arrivedThroughCloudflare solo mira cabeceras no vacias", () => {
      expect(arrivedThroughCloudflare(mkReq("127.0.0.1"))).toBe(false);
      expect(arrivedThroughCloudflare(mkReq("127.0.0.1", { "cf-ray": " " }))).toBe(false);
      expect(arrivedThroughCloudflare(mkReq("127.0.0.1", { "cf-ray": "abc" }))).toBe(true);
    });
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
