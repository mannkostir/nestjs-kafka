import type { KafkaJS } from "@confluentinc/kafka-javascript";
import { KafkaErrorHandleStrategy } from "./kafka-error-handle.strategy.js";

export class KafkaErrorHandleIgnoreStrategy extends KafkaErrorHandleStrategy {
    public async handle(error: unknown, payload: KafkaJS.EachBatchPayload, message: KafkaJS.KafkaMessage): Promise<void> {
        payload.resolveOffset(message.offset);
    }
}