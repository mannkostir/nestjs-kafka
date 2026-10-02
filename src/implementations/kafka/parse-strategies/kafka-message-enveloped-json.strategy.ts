import { KafkaMessageParseStrategy } from "./kafka-message-parse.strategy.js";
import { decodeJson } from "./decode-json.js";

type Envelope = { payload: unknown };

export class KafkaMessageEnvelopedJsonStrategy extends KafkaMessageParseStrategy {
    protected async parseValue(raw: Buffer): Promise<unknown> {
        const envelope = decodeJson(raw, 'value');

        if (envelope === null) {
            return null;
        }

        if (!KafkaMessageEnvelopedJsonStrategy.isEnvelope(envelope)) {
            throw new Error(
                'Expected the message value to be a { payload } envelope. ' +
                'Produce it with MessageFormat.ENVELOPED_JSON, or consume it with MessageFormat.JSON.',
            );
        }

        return typeof envelope.payload === 'string'
            ? decodeJson(envelope.payload, 'payload')
            : envelope.payload;
    }

    private static isEnvelope(value: unknown): value is Envelope {
        return typeof value === 'object'
            && value !== null
            && !Array.isArray(value)
            && Object.prototype.hasOwnProperty.call(value, 'payload');
    }
}
