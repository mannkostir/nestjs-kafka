import { EachBatchPayload, KafkaJSError, KafkaMessage } from "kafkajs";
import { KafkaErrorHandleStrategy } from "./kafka-error-handle.strategy";

export class KafkaErrorHandleIgnoreStrategy extends KafkaErrorHandleStrategy {
    public async handle(error: KafkaJSError, payload: EachBatchPayload, message: KafkaMessage): Promise<void> {
        payload.resolveOffset(message.offset);
        await payload.heartbeat();
    }
}