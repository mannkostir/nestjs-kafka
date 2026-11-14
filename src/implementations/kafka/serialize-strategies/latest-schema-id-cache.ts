import type { SchemaRegistry } from '@kafkajs/confluent-schema-registry';

export const DEFAULT_LATEST_SCHEMA_TTL_MS = 60000;

type CachedSchemaId = { id: number; expiresAt: number };

export class LatestSchemaIdCache {
  private readonly schemas = new Map<string, CachedSchemaId>();
  private readonly pending = new Map<string, Promise<number>>();

  constructor(
    private readonly registry: Pick<SchemaRegistry, 'getLatestSchemaId'>,
    private readonly ttl = DEFAULT_LATEST_SCHEMA_TTL_MS,
  ) {
    if (!Number.isFinite(ttl) || ttl < 0) {
      throw new Error('"schemaRegistry.latestSchemaTtl" must be a non-negative finite number of milliseconds.');
    }
  }

  public async getLatestSchemaId(subject: string): Promise<number> {
    if (this.ttl === 0) {
      return this.registry.getLatestSchemaId(subject);
    }

    const now = Date.now();
    const cached = this.schemas.get(subject);
    if (cached && cached.expiresAt > now) {
      return cached.id;
    }
    this.schemas.delete(subject);

    const pending = this.pending.get(subject);
    if (pending) {
      return pending;
    }

    const lookup = this.lookup(subject, now);
    this.pending.set(subject, lookup);
    try {
      return await lookup;
    } finally {
      this.pending.delete(subject);
    }
  }

  private async lookup(subject: string, startedAt: number): Promise<number> {
    const id = await this.registry.getLatestSchemaId(subject);
    this.schemas.set(subject, { id, expiresAt: startedAt + this.ttl });
    return id;
  }
}
