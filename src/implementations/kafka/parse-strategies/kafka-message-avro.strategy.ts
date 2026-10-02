import { KafkaMessageParseStrategy } from "./kafka-message-parse.strategy.js";
import type { SchemaRegistry } from "@kafkajs/confluent-schema-registry";

export class KafkaMessageAvroStrategy extends KafkaMessageParseStrategy {
    constructor(private readonly registry: SchemaRegistry) {
        super();
    }

    protected async parseValue(raw: Buffer): Promise<unknown> {
        return this.registry.decode(raw);
    }
}
