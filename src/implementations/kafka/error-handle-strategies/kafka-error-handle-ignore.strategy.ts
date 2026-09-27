import { EachBatchPayload, KafkaMessage } from "kafkajs";
import { KafkaErrorHandleStrategy } from "./kafka-error-handle.strategy.js";

export class KafkaErrorHandleIgnoreStrategy extends KafkaErrorHandleStrategy {
    public async handle(error: unknown, payload: EachBatchPayload, message: KafkaMessage): Promise<void> {
        payload.resolveOffset(message.offset);
        await payload.heartbeat();
    }
}