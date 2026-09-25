import { MessageValue } from "../../../types/message.type.js";
import { KafkaMessage } from "../kafka-message.js";
import { KafkaMessageParseStrategy } from "./kafka-message-parse.strategy.js";
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

        const value: MessageValue<Payload> = this.parseJson(
            raw.toString('utf8'),
            'value',
        );

        if (value && typeof value.payload === 'string') {
            value.payload = this.parseJson(value.payload, 'payload');
        }

        return value;
    }

    private parseJson<T>(text: string, part: 'value' | 'payload'): T {
        try {
            return JSON.parse(text);
        } catch (error) {
            throw new Error(
                `Failed to parse message ${part} as JSON: ${(error as Error).message}`,
            );
        }
    }
}
