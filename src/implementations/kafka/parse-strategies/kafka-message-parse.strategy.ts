import { KafkaMessage as KafkaJSMessage } from "kafkajs";
import { KafkaMessage } from "../kafka-message";
import type { MessageKey } from "../../../types/message.type";

export abstract class KafkaMessageParseStrategy<Payload extends Record<string, any>> {
    abstract parse(message: KafkaJSMessage): Promise<KafkaMessage<Payload>>;

    protected parseKey(raw: Buffer | string | null): MessageKey | null {
        if (raw === null || raw === undefined) {
            return null;
        }

        const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;

        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }
}