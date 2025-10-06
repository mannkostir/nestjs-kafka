import { KafkaMessage as KafkaJSMessage } from "kafkajs";
import { KafkaMessage } from "../kafka-message";

export abstract class KafkaMessageParseStrategy<Payload extends Record<string, any>> {
    abstract parse(message: KafkaJSMessage): Promise<KafkaMessage<Payload>>;
}