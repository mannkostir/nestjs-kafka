import { EachBatchPayload, IHeaders, Kafka, KafkaJSError, KafkaMessage, Producer } from "kafkajs";
import { KafkaErrorHandleStrategy } from "./kafka-error-handle.strategy";

export class KafkaErrorHandleDlqStrategy extends KafkaErrorHandleStrategy {
    private static readonly DEFAULT_DLQ_SUFFIX = '.dlq';

    private readonly dlqProducer: Promise<Producer>;

    constructor(
        kafka: Kafka,
        private readonly dlqTopic?: string,
    ) {
        super();

        const producer = kafka.producer({
            allowAutoTopicCreation: true,
            retry: {
              maxRetryTime: 30000,
              initialRetryTime: 300,
              factor: 0.2,
              multiplier: 2,
              retries: 15,
              restartOnFailure: async () => true,
            },
          });

          this.dlqProducer = (async () => {
            await producer.connect();
            return producer;
          })();
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

        await (await this.dlqProducer).send({
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