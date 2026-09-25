import { KafkaMessageParseStrategy } from "./kafka-message-parse.strategy.js";
import { KafkaMessage } from "../kafka-message.js";
import { KafkaMessage as KafkaJSMessage } from "kafkajs";
import type { SchemaRegistry } from "@kafkajs/confluent-schema-registry";
import { MessageValue } from "../../../types/message.type.js";

export class KafkaMessageAvroStrategy<Payload extends Record<string, any>> extends KafkaMessageParseStrategy<Payload> {
    constructor(private readonly registry: SchemaRegistry) {
        super();
    }

    public async parse(message: KafkaJSMessage): Promise<KafkaMessage<Payload>> {
        let value: MessageValue<Payload> | null = null;

        if (message.value) {
          value = await this.registry.decode(Buffer.from(message.value));
        }

        return new KafkaMessage<Payload>(this.parseKey(message.key), value);
    }
}
