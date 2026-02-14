import { EachBatchPayload, IHeaders, KafkaJSError, KafkaMessage, Producer } from "kafkajs";
import { KafkaErrorHandleStrategy } from "./kafka-error-handle.strategy";

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

    private buildDlqHeaders(error: KafkaJSError, originalTopic: string, originalHeaders?: IHeaders): IHeaders {
        return {
            ...originalHeaders,
            'dlq.original.topic': originalTopic,
            'dlq.error.message': error.message || 'Unknown error',
            'dlq.error.name': error.name || 'Error',
            ...(error.stack ? { 'dlq.error.stack': error.stack } : {}),
            'dlq.timestamp': new Date().toISOString(),
        };
    }

    public async handle(error: KafkaJSError, payload: EachBatchPayload, message: KafkaMessage): Promise<void> {
        const originalTopic = payload.batch.topic;

        await this.producer.send({
            topic: this.resolveDlqTopic(originalTopic),
            messages: [{
                ...message,
                headers: this.buildDlqHeaders(error, originalTopic, message.headers),
            }],
        });

        payload.resolveOffset(message.offset);
        await payload.heartbeat();
    }
}