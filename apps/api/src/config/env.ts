import { z } from "zod";

const booleanFromString = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return value;
}, z.boolean());

const optionalUrl = z.preprocess((value) => {
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}, z.string().url().optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z
      .string()
      .min(1)
      .refine((value) => value.startsWith("postgresql://"), "DATABASE_URL must use postgresql://"),
    JWT_SECRET: z.string().min(16),
    JWT_EXPIRES_IN: z.string().default("1d"),
    JWT_REFRESH_SECRET: z.string().min(16).optional(),
    JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
    AUTH_ADMIN_EMAILS: z.string().default(""),
    AUTH_COOKIE_ACCESS_NAME: z.string().default("prive_access_token"),
    AUTH_COOKIE_REFRESH_NAME: z.string().default("prive_refresh_token"),
    AUTH_COOKIE_SECURE: booleanFromString.default(false),
    AUTH_COOKIE_SAME_SITE: z.enum(["lax", "strict", "none"]).default("lax"),
    AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),
    WEB_APP_URL: z.string().url(),
    GOOGLE_OAUTH_CLIENT_ID: z.string().min(1),
    GOOGLE_OAUTH_CLIENT_SECRET: z.string().min(1),
    GOOGLE_OAUTH_REDIRECT_URI: z.string().url(),
    GOOGLE_MAPS_EMBED_API_KEY: z.string().optional(),
    MDPA_BULK_FILE_PATH: z.string().min(1),
    MDPA_SOURCE_URL: optionalUrl,
    MDPA_MAX_ROWS: z.coerce.number().int().positive().default(1000),
    MDPA_REQUIRE_CONFIRMATION: booleanFromString.default(true),
    MDPA_ESTIMATED_CREDITS: z.coerce.number().int().positive().default(50),
    ARCGIS_MAX_ROWS: z.coerce.number().int().positive().default(50),
    MIAMI_DADE_PARCELS_URL: z.string().url(),
    MIAMI_DADE_FORECLOSURE_URL: optionalUrl,
    MIAMI_DADE_FORECLOSURE_API_KEY: z.string().optional(),
    MIAMI_DADE_FORECLOSURE_MAX_FOLIOS: z.coerce.number().int().positive().default(40),
    BROWARD_FORECLOSURE_URL: optionalUrl,
    BROWARD_FORECLOSURE_API_KEY: z.string().optional(),
    BROWARD_FORECLOSURE_CASE_TYPES: z.string().optional(),
    BROWARD_FORECLOSURE_COURT_TYPE: z.string().optional(),
    BROWARD_FORECLOSURE_DATE_TO_USE: z.string().optional(),
    BROWARD_FORECLOSURE_LOOKBACK_DAYS: z.coerce.number().int().positive().default(7),
    BROWARD_FORECLOSURE_MAX_REQUESTS: z.coerce.number().int().positive().default(200),
    BROWARD_FORECLOSURE_MAX_CASES: z.coerce.number().int().positive().default(250),
    BROWARD_FORECLOSURE_REQUIRE_CONFIRMATION: booleanFromString.default(true),
    BROWARD_FORECLOSURE_ESTIMATED_CREDITS: z.coerce.number().int().positive().default(250),
    BROWARD_PARCELS_URL: z.string().url(),
    PALM_BEACH_PARCELS_URL: z.string().url(),
    GEOCODING_PROVIDER: z.enum(["none", "google"]).default("none"),
    GEOCODING_API_KEY: z.string().optional(),
    CHAT_ENABLE: booleanFromString.default(true),
    CHAT_STRUCTURED_V2: booleanFromString.default(true),
    CHAT_MAX_CONTEXT_DEALS: z.coerce.number().int().positive().default(20),
    AGENTS_V1_ENABLED: booleanFromString.default(false),
    AGENTS_RESPONSES_ENABLED: booleanFromString.default(false),
    AGENTS_WEB_VERIFY_ENABLED: booleanFromString.default(false),
    AGENTS_MUTATIONS_ENABLED: booleanFromString.default(false),
    AGENTS_DEFAULT_MODEL: z.string().default("gpt-4.1-mini"),
    AGENTS_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
    OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(12000),
  })
  .superRefine((env, ctx) => {
    if (env.JWT_SECRET === "change_me") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["JWT_SECRET"],
        message: "JWT_SECRET must be replaced from the default value",
      });
    }

    if (env.GOOGLE_OAUTH_CLIENT_SECRET === env.GOOGLE_OAUTH_CLIENT_ID) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["GOOGLE_OAUTH_CLIENT_SECRET"],
        message: "GOOGLE_OAUTH_CLIENT_SECRET cannot match GOOGLE_OAUTH_CLIENT_ID",
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(rawEnv: NodeJS.ProcessEnv): AppEnv {
  const parsed = envSchema.safeParse(rawEnv);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }

  return parsed.data;
}
