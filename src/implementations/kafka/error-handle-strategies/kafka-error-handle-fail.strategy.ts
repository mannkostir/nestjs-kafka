import { KafkaJSError, EachBatchPayload, KafkaMessage } from "kafkajs";
import { KafkaErrorHandleStrategy } from "./kafka-error-handle.strategy";

export class KafkaErrorHandleFailStrategy extends KafkaErrorHandleStrategy {
    public async handle(error: KafkaJSError, payload: EachBatchPayload, message: KafkaMessage): Promise<void> {
        throw error;
    }
}