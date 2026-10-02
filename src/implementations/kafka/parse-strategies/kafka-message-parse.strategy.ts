import type { KafkaJS } from "@confluentinc/kafka-javascript";
import { KafkaMessage } from "../kafka-message.js";
import type { MessageHeaders, MessageKey } from "../../../types/message.type.js";

type HeaderValue = Buffer | string | (Buffer | string)[];

export abstract class KafkaMessageParseStrategy {
    public async parse(message: KafkaJS.KafkaMessage): Promise<KafkaMessage> {
        return new KafkaMessage(
            KafkaMessageParseStrategy.parseKey(message.key),
            message.value ? await this.parseValue(message.value) : null,
            KafkaMessageParseStrategy.parseHeaders(message.headers),
        );
    }

    protected abstract parseValue(raw: Buffer): Promise<unknown>;

    private static parseKey(raw: Buffer | string | null): MessageKey | null {
        if (raw === null || raw === undefined) {
            return null;
        }

        const text = KafkaMessageParseStrategy.decodeText(raw);

        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }

    private static parseHeaders(raw: KafkaJS.IHeaders | undefined): MessageHeaders {
        return Object.fromEntries(
            Object.entries(raw ?? {}).flatMap(([name, value]) =>
                value === undefined ? [] : [[name, KafkaMessageParseStrategy.decodeHeader(value)]],
            ),
        );
    }

    private static decodeHeader(value: HeaderValue): string | string[] {
        return Array.isArray(value)
            ? value.map(KafkaMessageParseStrategy.decodeText)
            : KafkaMessageParseStrategy.decodeText(value);
    }

    private static decodeText(raw: Buffer | string): string {
        return Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
    }
}