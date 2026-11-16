export interface AppConfig {
  port: number;
  nodeEnv: string;
  corsOrigins: string[];
  dbDialect: 'sqlite' | 'postgres';
  sqlitePath: string;
  databaseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  reservationExpiryMinutes: number;
  paymentGatewayMode: 'local_stub' | 'sandbox_http';
  sandboxGatewayUrl: string;
  sandboxGatewayApiKey: string;
  sandboxGatewayTimeoutMs: number;
}

export function getConfig(): AppConfig {
  const rawCors = process.env.CORS_ORIGIN || 'http://localhost:3000,http://127.0.0.1:3000';
  const appUrl = process.env.APP_URL;
  const origins = rawCors
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (appUrl && !origins.includes(appUrl)) {
    origins.push(appUrl);
  }

  return {
    port: Number(process.env.PORT || 3000),
    nodeEnv: process.env.NODE_ENV || 'development',
    corsOrigins: origins,
    dbDialect: process.env.DB_DIALECT === 'postgres' ? 'postgres' : 'sqlite',
    sqlitePath: process.env.SQLITE_PATH || './data/fulfilliq.db',
    databaseUrl:
      process.env.DATABASE_URL || 'postgres://fulfilliq:fulfilliq_dev@localhost:5432/fulfilliq',
    jwtSecret: process.env.JWT_SECRET || 'fulfilliq-dev-only-jwt-secret-change-in-prod',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
    reservationExpiryMinutes: Number(process.env.RESERVATION_EXPIRY_MINUTES || 15),
    paymentGatewayMode:
      process.env.PAYMENT_GATEWAY_MODE === 'sandbox_http' ? 'sandbox_http' : 'local_stub',
    sandboxGatewayUrl: process.env.SANDBOX_GATEWAY_URL || 'http://localhost:4010/v1/charges',
    sandboxGatewayApiKey: process.env.SANDBOX_GATEWAY_API_KEY || 'sandbox_test_key',
    sandboxGatewayTimeoutMs: Number(process.env.SANDBOX_GATEWAY_TIMEOUT_MS || 2500),
  };
}
