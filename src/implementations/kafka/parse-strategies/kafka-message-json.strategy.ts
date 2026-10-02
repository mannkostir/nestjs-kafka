import { KafkaMessage } from "../kafka-message.js";
import { KafkaMessageParseStrategy } from "./kafka-message-parse.strategy.js";
import { decodeJson } from "./decode-json.js";
import type { KafkaJS } from "@confluentinc/kafka-javascript";

export class KafkaMessageJsonStrategy extends KafkaMessageParseStrategy {
    public async parse(message: KafkaJS.KafkaMessage): Promise<KafkaMessage> {
        return new KafkaMessage(
            this.parseKey(message.key),
            message.value ? decodeJson(message.value, 'value') : null,
        );
    }
}
