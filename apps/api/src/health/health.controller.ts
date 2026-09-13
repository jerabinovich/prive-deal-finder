import { Controller, Get, Logger, Res } from "@nestjs/common";
import type { Response } from "express";
import { Public } from "../auth/public.decorator";
import { PrismaService } from "../shared/prisma.service";

/**
 * HEALTH CHECK — reescrito 12-sep-2026
 *
 * POR QUE. La version anterior devolvia {status:"ok"} mirando solo
 * `process.uptime()`: decia que el proceso vivia, nada mas. Resultado real:
 * la API paso DIAS respondiendo "ok" con un DATABASE_URL que apuntaba a una
 * base inexistente. Un health check que no toca la base no sirve para saber
 * si el servicio funciona; sirve para saber si el proceso arranco.
 *
 * QUE HACE AHORA. Ejecuta un `SELECT 1` real contra Postgres y devuelve
 * HTTP 503 si falla. Importa el codigo, no solo el cuerpo: el smoke test
 * diario (prive-deal-finder-ops/scripts/remote_daily_report.sh) llama con
 * `curl -fsS`, que solo falla ante un status no-2xx. Con 200 fijo, una base
 * caida pasaba desapercibida.
 *
 * ES ENDPOINT PUBLICO (@Public): no expone el mensaje de error ni la cadena
 * de conexion. El detalle va al log del servidor; afuera solo "ok"/"error".
 *
 * TIMEOUT. La consulta corta a los 2s para que una base colgada no cuelgue
 * tambien al health check (que es justo cuando mas se lo necesita).
 */
const DB_TIMEOUT_MS = 2000;

@Controller()
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get("health")
  async health(@Res({ passthrough: true }) res: Response) {
    const startedAt = Date.now();
    let database: { status: "ok" | "error"; latencyMs?: number } = { status: "error" };

    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`db check timeout after ${DB_TIMEOUT_MS}ms`)), DB_TIMEOUT_MS),
        ),
      ]);
      database = { status: "ok", latencyMs: Date.now() - startedAt };
    } catch (error) {
      // El detalle queda del lado del servidor a proposito: el endpoint es publico.
      this.logger.error(`health: la base no responde -> ${String((error as Error)?.message ?? error)}`);
    }

    const healthy = database.status === "ok";
    if (!healthy) res.status(503);

    return {
      status: healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      database,
    };
  }
}
