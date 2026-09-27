import { EachBatchPayload, IHeaders, KafkaMessage, Producer } from "kafkajs";
import { KafkaErrorHandleStrategy } from "./kafka-error-handle.strategy.js";

type FailureDescription = {
    name: string;
    message: string;
    stack?: string;
};

export class KafkaErrorHandleDlqStrategy extends KafkaErrorHandleStrategy {
    private static readonly DEFAULT_DLQ_SUFFIX = '.dlq';

    constructor(
        private readonly producer: Producer,
        private readonly dlqTopic?: string,
    ) {
        super();
    }

    private resolveDlqTopic(originalTopic: string): string {
        return this.dlqTopic || `${originalTopic}${KafkaErrorHandleDlqStrategy.DEFAULT_DLQ_SUFFIX}`;
    }

    private static describeFailure(error: unknown): FailureDescription {
        if (error instanceof Error) {
            return {
                name: error.name || 'Error',
                message: error.message || 'Unknown error',
                stack: error.stack,
            };
        }

        return { name: 'Error', message: String(error) };
    }

    private buildDlqHeaders(error: unknown, originalTopic: string, originalHeaders?: IHeaders): IHeaders {
        const failure = KafkaErrorHandleDlqStrategy.describeFailure(error);

        return {
            ...originalHeaders,
            'dlq.original.topic': originalTopic,
            'dlq.error.message': failure.message,
            'dlq.error.name': failure.name,
            ...(failure.stack ? { 'dlq.error.stack': failure.stack } : {}),
            'dlq.timestamp': new Date().toISOString(),
        };
    }

    public async handle(error: unknown, payload: EachBatchPayload, message: KafkaMessage): Promise<void> {
        const originalTopic = payload.batch.topic;

        await this.producer.send({
            topic: this.resolveDlqTopic(originalTopic),
            messages: [{
                key: message.key,
                value: message.value,
                timestamp: message.timestamp,
                headers: this.buildDlqHeaders(error, originalTopic, message.headers),
            }],
        });

        payload.resolveOffset(message.offset);
        await payload.heartbeat();
    }
}