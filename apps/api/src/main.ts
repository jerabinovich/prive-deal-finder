import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { validateEnv } from "./config/env";
import { ApiExceptionFilter } from "./shared/http-exception.filter";

async function bootstrap() {
  const env = validateEnv(process.env);
  const allowedExactOrigins = new Set(
    env.WEB_APP_URL.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  const isAllowedRunAppOrigin = (origin: string) =>
    /^https:\/\/prive-deal-finder-web-[a-z0-9-]+(\.[a-z0-9-]+)*\.run\.app$/i.test(origin);

  const app = await NestFactory.create(AppModule, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }

        if (allowedExactOrigins.has(origin) || isAllowedRunAppOrigin(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`CORS blocked for origin: ${origin}`), false);
      },
      credentials: true,
    },
  });

  app.setGlobalPrefix("api");
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalFilters(new ApiExceptionFilter());

  await app.listen(env.PORT);
  // eslint-disable-next-line no-console
  console.log(`API listening on ${env.PORT}`);
}

bootstrap();
