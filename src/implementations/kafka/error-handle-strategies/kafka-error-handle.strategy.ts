import type { KafkaJS } from "@confluentinc/kafka-javascript";

export abstract class KafkaErrorHandleStrategy {
    public abstract handle(error: unknown, payload: KafkaJS.EachBatchPayload, message: KafkaJS.KafkaMessage): Promise<void>;

    public destinationTopics(sourceTopics: string[]): string[] {
        return [];
    }

    public consumedTopics(sourceTopics: string[]): string[] {
        return [];
    }

    public isDue(payload: KafkaJS.EachBatchPayload, message: KafkaJS.KafkaMessage): boolean {
        return true;
    }

    public holdUntilDue(payload: KafkaJS.EachBatchPayload, message: KafkaJS.KafkaMessage): boolean {
        return false;
    }

    public stop(): void {}
}