import { EachBatchPayload, KafkaMessage } from "kafkajs";
import { KafkaErrorHandleStrategy } from "./kafka-error-handle.strategy.js";

export class KafkaErrorHandleFailStrategy extends KafkaErrorHandleStrategy {
    public async handle(error: unknown, payload: EachBatchPayload, message: KafkaMessage): Promise<void> {
        throw error;
    }
}