import { EachBatchPayload, KafkaMessage } from "kafkajs";

export abstract class KafkaErrorHandleStrategy {
    public abstract handle(error: unknown, payload: EachBatchPayload, message: KafkaMessage): Promise<void>;
}