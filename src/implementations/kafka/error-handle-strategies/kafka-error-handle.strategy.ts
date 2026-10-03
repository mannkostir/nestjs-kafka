import type { KafkaJS } from "@confluentinc/kafka-javascript";

export abstract class KafkaErrorHandleStrategy {
    public abstract handle(error: unknown, payload: KafkaJS.EachBatchPayload, message: KafkaJS.KafkaMessage): Promise<void>;

    public destinationTopics(sourceTopics: string[]): string[] {
        return [];
    }

    public stop(): void {}
}