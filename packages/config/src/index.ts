import Joi from 'joi';

// ─────────────────────────────────────────────────────────────────────────────
// Environment Validation Schema
// Call validateEnv() at service startup. Process exits if any required var
// is missing — fail-fast is safer than silent misconfiguration.
// ─────────────────────────────────────────────────────────────────────────────

export function validateEnv(extraSchema?: Joi.ObjectSchema): Record<string, unknown> {
  const baseSchema = Joi.object({
    NODE_ENV: Joi.string().valid('development', 'test', 'production').required(),
    LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  }).options({ allowUnknown: true });

  const schema = extraSchema ? baseSchema.concat(extraSchema) : baseSchema;

  const { error, value } = schema.validate(process.env);
  if (error) {
    throw new Error(`Environment validation failed: ${error.message}`);
  }
  return value as Record<string, unknown>;
}

// ─── Kafka config factory ─────────────────────────────────────────────────────

export function kafkaConfig(clientIdSuffix: string) {
  const prefix = process.env['KAFKA_GROUP_ID_PREFIX'] ?? 'chainstrike';
  return {
    brokers: (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(','),
    clientId: `${process.env['KAFKA_CLIENT_ID'] ?? 'chainstrike'}-${clientIdSuffix}`,
    consumerGroup: `${prefix}-${clientIdSuffix}`,
    groupIdPrefix: prefix,
  };
}

// ─── Redis config factory ─────────────────────────────────────────────────────

export function redisConfig() {
  return {
    host: process.env['REDIS_HOST'] ?? 'localhost',
    port: parseInt(process.env['REDIS_PORT'] ?? '6379', 10),
    password: process.env['REDIS_PASSWORD'] || undefined,
    db: parseInt(process.env['REDIS_DB'] ?? '0', 10),
  };
}

// ─── Algorand config factory ──────────────────────────────────────────────────

export function algorandConfig() {
  return {
    algodHost: process.env['ALGORAND_ALGOD_SERVER'] ?? process.env['ALGOD_HOST'] ?? 'http://localhost',
    algodPort: parseInt(process.env['ALGORAND_ALGOD_PORT'] ?? process.env['ALGOD_PORT'] ?? '4001', 10),
    algodToken: process.env['ALGORAND_ALGOD_TOKEN'] ?? process.env['ALGOD_TOKEN'] ?? '',
    indexerHost: process.env['ALGORAND_INDEXER_SERVER'] ?? process.env['INDEXER_HOST'] ?? 'http://localhost',
    indexerPort: parseInt(process.env['ALGORAND_INDEXER_PORT'] ?? process.env['INDEXER_PORT'] ?? '8980', 10),
    indexerToken: process.env['ALGORAND_INDEXER_TOKEN'] ?? process.env['INDEXER_TOKEN'] ?? '',
    network: (process.env['ALGORAND_NETWORK'] ?? 'localnet') as 'localnet' | 'testnet' | 'mainnet',
    usdcAssetId: parseInt(process.env['USDC_ASSET_ID'] ?? '0', 10),
  };
}

// ─── JWT config factory ───────────────────────────────────────────────────────

export function jwtConfig() {
  const secret = process.env['JWT_SECRET'];
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
  }
  return {
    secret,
    accessExpiry: process.env['JWT_ACCESS_EXPIRES_IN'] ?? process.env['JWT_ACCESS_EXPIRY'] ?? '15m',
    refreshExpiry: process.env['JWT_REFRESH_EXPIRES_IN'] ?? process.env['JWT_REFRESH_EXPIRY'] ?? '7d',
  };
}

// ─── Sumsub config factory ────────────────────────────────────────────────────

export function sumsubConfig() {
  return {
    appToken: process.env['SUMSUB_APP_TOKEN'] ?? '',
    secretKey: process.env['SUMSUB_SECRET_KEY'] ?? '',
    baseUrl: process.env['SUMSUB_BASE_URL'] ?? 'https://api.sumsub.com',
    webhookSecret: process.env['SUMSUB_WEBHOOK_SECRET'] ?? '',
  };
}

// ─── Fee schedule ─────────────────────────────────────────────────────────────

export const FeeSchedule = {
  MAKER_FEE_RATE: 0.001,   // 0.10%
  TAKER_FEE_RATE: 0.0025,  // 0.25%
  MIN_FEE_USDC: 1_000n,    // 0.001 USDC minimum (in microunits)
} as const;

// ─── Platform constants ───────────────────────────────────────────────────────

export const PlatformConstants = {
  // USDC has 6 decimal places on Algorand
  USDC_DECIMALS: 6,
  USDC_SCALE: 1_000_000n,

  // Trading limits by KYC tier (rolling 12-month, in USDC microunits)
  TIER1_ANNUAL_LIMIT: 12_000_000_000n,    // $12,000 USD
  TIER2_ANNUAL_LIMIT: 600_000_000_000n,   // $600,000 USD
  TIER3_ANNUAL_LIMIT: 0n,                 // Unlimited (0 = no limit)

  // Price band: order must be within ±20% of oracle reference price
  PRICE_BAND_PCT: 0.20,

  // Circuit breaker: pause trading if price moves ±10% within 5 minutes
  CIRCUIT_BREAKER_PCT: 0.10,
  CIRCUIT_BREAKER_WINDOW_MS: 5 * 60 * 1000,
  CIRCUIT_BREAKER_PAUSE_MS: 15 * 60 * 1000,

  // Settlement timeout: user must sign within 30 seconds
  SETTLEMENT_SIGN_TIMEOUT_MS: 30_000,

  // Settlement retry: max 3 attempts before escalating
  SETTLEMENT_MAX_RETRIES: 3,
} as const;
