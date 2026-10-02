import { KafkaMessageParseStrategy } from "./kafka-message-parse.strategy.js";
import { KafkaMessage } from "../kafka-message.js";
import type { KafkaJS } from "@confluentinc/kafka-javascript";
import type { SchemaRegistry } from "@kafkajs/confluent-schema-registry";

export class KafkaMessageAvroStrategy extends KafkaMessageParseStrategy {
    constructor(private readonly registry: SchemaRegistry) {
        super();
    }

    public async parse(message: KafkaJS.KafkaMessage): Promise<KafkaMessage> {
        const value: unknown = message.value
          ? await this.registry.decode(Buffer.from(message.value))
          : null;

        return new KafkaMessage(this.parseKey(message.key), value);
    }
}
