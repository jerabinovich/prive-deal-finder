import { CacheModule } from "@nestjs/cache-manager";
import { Global, Logger, Module } from "@nestjs/common";
import { redisStore } from "cache-manager-ioredis-yet";

const logger = new Logger("AppCacheModule");

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: async () => {
        const host = process.env.REDIS_HOST ?? "127.0.0.1";
        const port = Number(process.env.REDIS_PORT ?? 6379);
        try {
          const store = await redisStore({ host, port, ttl: 0 });
          logger.log(`Redis cache connected at ${host}:${port}`);
          return { store };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.warn(`Redis unavailable (${msg}) — falling back to in-memory cache`);
          return { ttl: 0 };
        }
      },
    }),
  ],
})
export class AppCacheModule {}
