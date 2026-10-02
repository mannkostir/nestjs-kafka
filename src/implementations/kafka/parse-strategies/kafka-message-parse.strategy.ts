import type { KafkaJS } from "@confluentinc/kafka-javascript";
import { KafkaMessage } from "../kafka-message.js";
import type { MessageKey } from "../../../types/message.type.js";

export abstract class KafkaMessageParseStrategy {
    abstract parse(message: KafkaJS.KafkaMessage): Promise<KafkaMessage>;

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