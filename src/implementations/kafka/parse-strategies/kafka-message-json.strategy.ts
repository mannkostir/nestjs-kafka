import { KafkaMessageParseStrategy } from "./kafka-message-parse.strategy.js";
import { decodeJson } from "./decode-json.js";

export class KafkaMessageJsonStrategy extends KafkaMessageParseStrategy {
    protected async parseValue(raw: Buffer): Promise<unknown> {
        return decodeJson(raw, 'value');
    }
}
