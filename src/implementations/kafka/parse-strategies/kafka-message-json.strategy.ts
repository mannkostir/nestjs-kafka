import { MessageKey, MessageValue } from "../../../types/message.type";
import { KafkaMessage } from "../kafka-message";
import { KafkaMessageParseStrategy } from "./kafka-message-parse.strategy";
import { KafkaMessage as KafkaJSMessage } from "kafkajs";

export class KafkaMessageJsonStrategy<Payload extends Record<string, any>> extends KafkaMessageParseStrategy<Payload> {
    public async parse(message: KafkaJSMessage): Promise<KafkaMessage<Payload>> {
        let value: MessageValue<Payload> | null = null;
        let key: MessageKey | null = null;

        if (message.value) {
            try {
                value = JSON.parse(message.value.toString());
            } catch (error) {
                value = null;
            }

            if (value && value.payload && typeof value.payload === 'string') {
                value.payload = JSON.parse(value.payload);
            }
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