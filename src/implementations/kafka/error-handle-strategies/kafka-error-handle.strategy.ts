import { EachBatchPayload, KafkaJSError, KafkaMessage } from "kafkajs";

export abstract class KafkaErrorHandleStrategy {
    public abstract handle(error: KafkaJSError, payload: EachBatchPayload, message: KafkaMessage): Promise<void>;
}