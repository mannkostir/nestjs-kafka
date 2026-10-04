import type { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { KafkaMessageSerializeStrategy } from './kafka-message-serialize.strategy.js';
import { SerializeTarget } from './serialize-target.js';

export class KafkaMessageAvroSerializeStrategy extends KafkaMessageSerializeStrategy {
  constructor(
    private readonly registry: SchemaRegistry,
    private readonly target: SerializeTarget,
  ) {
    super();
    assertValidTarget(target);
  }

  public async serialize(value: unknown): Promise<Buffer | null> {
    if (value === null) {
      return null;
    }

    return this.registry.encode(await this.resolveSchemaId(), value);
  }

  private async resolveSchemaId(): Promise<number> {
    const { topic, schemaId, subject } = this.target;

    return schemaId ?? this.registry.getLatestSchemaId(subject ?? `${topic}-value`);
  }
}

function assertValidTarget({ topic, schemaId, subject }: SerializeTarget): void {
  if (schemaId !== undefined && subject !== undefined) {
    throw new Error(
      'Avro send options "schemaId" and "subject" are mutually exclusive. ' +
      'Pass "schemaId" to encode with that exact schema, or "subject" to use its latest version.',
    );
  }

  if (schemaId !== undefined && !(Number.isInteger(schemaId) && schemaId > 0)) {
    throw new Error(
      `Avro send option "schemaId" must be a positive integer registry id. Got ${schemaId}.`,
    );
  }

  if (subject === '') {
    throw new Error(
      'Avro send option "subject" must not be an empty string. ' +
      `Pass a subject name, or omit it to use "${topic}-value".`,
    );
  }
}
