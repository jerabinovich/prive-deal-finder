export const APP_ROLES = ["ADMIN", "ANALYST", "PARTNER"] as const;

export type AppRole = (typeof APP_ROLES)[number];
