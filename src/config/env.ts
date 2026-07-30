import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3002",
  databaseUrl: process.env.DATABASE_URL ?? "",
  usdaApiKey: process.env.USDA_API_KEY ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "nutri-dev-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
};

export function assertDatabaseUrl(): string {
  return required("DATABASE_URL", env.databaseUrl);
}
