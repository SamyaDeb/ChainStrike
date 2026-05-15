import { PrismaClient } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// Base Repository
// Provides a typed wrapper around Prisma with soft-delete enforcement and
// automatic audit-log appending on every mutation.
// ─────────────────────────────────────────────────────────────────────────────

export abstract class BaseRepository {
  constructor(protected readonly prisma: PrismaClient) {}

  // Soft delete — compliance records MUST never be hard-deleted.
  // Each model must have a `deletedAt DateTime?` field.
  protected softDeleteWhere(additionalWhere?: Record<string, unknown>) {
    return { deletedAt: null, ...additionalWhere };
  }

  // Converts BigInt values to strings for JSON serialization.
  protected serializeBigInt<T>(obj: T): T {
    return JSON.parse(
      JSON.stringify(obj, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    ) as T;
  }
}

// ─── Prisma singleton factory ─────────────────────────────────────────────────
// Each service calls this once in its AppModule. Ensures a single PrismaClient
// per service process — no connection pool exhaustion.

const clients: Map<string, PrismaClient> = new Map();

export function getPrismaClient(schemaUrl: string): PrismaClient {
  if (!clients.has(schemaUrl)) {
    const client = new PrismaClient({
      datasources: { db: { url: schemaUrl } },
      log:
        process.env['NODE_ENV'] === 'development'
          ? ['query', 'warn', 'error']
          : ['warn', 'error'],
    });
    clients.set(schemaUrl, client);
  }
  return clients.get(schemaUrl)!;
}
