import { MessageValue } from "../../../types/message.type";
import { KafkaMessage } from "../kafka-message";
import { KafkaMessageParseStrategy } from "./kafka-message-parse.strategy";
import { KafkaMessage as KafkaJSMessage } from "kafkajs";

export class KafkaMessageJsonStrategy<Payload extends Record<string, any>> extends KafkaMessageParseStrategy<Payload> {
    public async parse(message: KafkaJSMessage): Promise<KafkaMessage<Payload>> {
        return new KafkaMessage<Payload>(
            this.parseKey(message.key),
            this.parseValue(message.value),
        );
    }

    private parseValue(raw: Buffer | null): MessageValue<Payload> | null {
        if (!raw) {
            return null;
        }

        const text = raw.toString('utf8');

        let value: MessageValue<Payload>;

        try {
            value = JSON.parse(text);
        } catch (error) {
            throw new Error(
                `Failed to parse message value as JSON: ${(error as Error).message}`,
            );
        }

        if (value && typeof value.payload === 'string') {
            value.payload = JSON.parse(value.payload);
        }

        return value;
    }
}
