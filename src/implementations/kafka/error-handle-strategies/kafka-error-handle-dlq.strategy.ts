import type { KafkaJS } from "@confluentinc/kafka-javascript";
import { KafkaErrorHandleStrategy } from "./kafka-error-handle.strategy.js";
import { describeFailure } from "./failure-description.js";

export class KafkaErrorHandleDlqStrategy extends KafkaErrorHandleStrategy {
    private static readonly DEFAULT_DLQ_SUFFIX = '.dlq';

    constructor(
        private readonly producer: KafkaJS.Producer,
        private readonly dlqTopic?: string,
    ) {
        super();
    }

    public destinationTopics(sourceTopics: string[]): string[] {
        if (this.dlqTopic) {
            return [this.dlqTopic];
        }

        return sourceTopics.map((topic) => this.resolveDlqTopic(topic));
    }

    private resolveDlqTopic(originalTopic: string): string {
        return this.dlqTopic || `${originalTopic}${KafkaErrorHandleDlqStrategy.DEFAULT_DLQ_SUFFIX}`;
    }

    private buildDlqHeaders(error: unknown, originalTopic: string, originalHeaders?: KafkaJS.IHeaders): KafkaJS.IHeaders {
        const failure = describeFailure(error);

        return {
            ...originalHeaders,
            'dlq.original.topic': originalTopic,
            'dlq.error.message': failure.message,
            'dlq.error.name': failure.name,
            ...(failure.stack ? { 'dlq.error.stack': failure.stack } : {}),
            'dlq.timestamp': new Date().toISOString(),
        };
    }

    public async publish(error: unknown, originalTopic: string, message: KafkaJS.KafkaMessage): Promise<void> {
        await this.producer.send({
            topic: this.resolveDlqTopic(originalTopic),
            messages: [{
                key: message.key,
                value: message.value,
                timestamp: message.timestamp,
                headers: this.buildDlqHeaders(error, originalTopic, message.headers),
            }],
        });
    }

    public async handle(error: unknown, payload: KafkaJS.EachBatchPayload, message: KafkaJS.KafkaMessage): Promise<void> {
        await this.publish(error, payload.batch.topic, message);
        payload.resolveOffset(message.offset);
    }
}