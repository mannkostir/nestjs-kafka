import { KafkaMessageParseStrategy } from "./kafka-message-parse.strategy";
import { KafkaMessage } from "../kafka-message";
import { KafkaMessage as KafkaJSMessage } from "kafkajs";
import { SchemaRegistry } from "@kafkajs/confluent-schema-registry";
import { MessageKey, MessageValue } from "../../../types/message.type";

export class KafkaMessageAvroStrategy<Payload extends Record<string, any>> extends KafkaMessageParseStrategy<Payload> {
    constructor(private readonly registry: SchemaRegistry) {
        super();
    }

    public async parse(message: KafkaJSMessage): Promise<KafkaMessage<Payload>> {
        let value: MessageValue<Payload> | null = null;
        let key: MessageKey | null = null;
    
        if (message.value) {
          value = await this.registry.decode(Buffer.from(message.value.toJSON().data));
        }
        if (message.key) {
          const processedKey = Buffer.isBuffer(message.key)
            ? message.key.toString('utf8')
            : message.key;
    
          key = JSON.parse(processedKey);
        }
    
        return new KafkaMessage<Payload>(key, value);
    }
}