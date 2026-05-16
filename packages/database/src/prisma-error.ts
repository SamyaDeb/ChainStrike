export class UniqueConstraintError extends Error {
  constructor(
    public readonly field: string,
    message?: string,
  ) {
    super(message ?? `${field} already exists`);
    this.name = 'UniqueConstraintError';
  }
}

export class RecordNotFoundError extends Error {
  constructor(
    public readonly entity: string,
    public readonly id: string,
  ) {
    super(`${entity} with id ${id} not found`);
    this.name = 'RecordNotFoundError';
  }
}

// Converts Prisma errors to domain errors so services don't leak DB internals.
export function handlePrismaError(error: unknown): never {
  const prismaError = error as { code?: string; meta?: Record<string, unknown> } | undefined;
  if (prismaError?.code) {
    if (prismaError.code === 'P2002') {
      const field = (prismaError.meta?.['target'] as string[] | undefined)?.join(', ') ?? 'field';
      throw new UniqueConstraintError(field);
    }
    if (prismaError.code === 'P2025') {
      throw new RecordNotFoundError('Record', 'unknown');
    }
  }
  throw error;
}
