import winston, { createLogger, format, transports } from 'winston';
import 'winston-daily-rotate-file';

const { combine, timestamp, errors, json, colorize, simple } = format;

const isDev = process.env['NODE_ENV'] !== 'production';

// Structured JSON log format for production (ingestible by log aggregators)
const productionFormat = combine(timestamp(), errors({ stack: true }), json());

// Human-readable format for local development
const developmentFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  simple(),
);

export function createServiceLogger(serviceName: string): winston.Logger {
  const logger = createLogger({
    level: process.env['LOG_LEVEL'] ?? (isDev ? 'debug' : 'info'),
    defaultMeta: { service: serviceName },
    format: isDev ? developmentFormat : productionFormat,
    transports: [new transports.Console()],
  });

  if (!isDev) {
    // Rotate files for production: separate error and combined logs
    logger.add(
      new (transports as any).DailyRotateFile({
        filename: `logs/${serviceName}-%DATE%-error.log`,
        datePattern: 'YYYY-MM-DD',
        level: 'error',
        maxSize: '20m',
        maxFiles: '30d',
      }),
    );
    logger.add(
      new (transports as any).DailyRotateFile({
        filename: `logs/${serviceName}-%DATE%-combined.log`,
        datePattern: 'YYYY-MM-DD',
        maxSize: '20m',
        maxFiles: '14d',
      }),
    );
  }

  return logger;
}

// Compliance audit logger — writes to a separate, append-only channel
// Retained for 7 years; never overwritten or deleted
export function createComplianceLogger(): winston.Logger {
  return createLogger({
    level: 'info',
    defaultMeta: { channel: 'compliance-audit' },
    format: productionFormat,
    transports: [
      new transports.Console(),
      new (transports as any).DailyRotateFile({
        filename: `logs/compliance-audit-%DATE%.log`,
        datePattern: 'YYYY-MM-DD',
        maxSize: '50m',
        maxFiles: '2555d', // 7 years
        auditFile: 'logs/.audit-log-state.json',
      }),
    ],
  });
}
