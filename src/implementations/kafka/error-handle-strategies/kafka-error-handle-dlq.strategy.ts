import { EachBatchPayload, Kafka, KafkaJSError, KafkaMessage, Producer } from "kafkajs";
import { KafkaErrorHandleStrategy } from "./kafka-error-handle.strategy";

export class KafkaErrorHandleDlqStrategy extends KafkaErrorHandleStrategy {
    private readonly dlqProducer: Promise<Producer>;

    constructor(kafka: Kafka) {
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

    public async handle(error: KafkaJSError, payload: EachBatchPayload, message: KafkaMessage): Promise<void> {
        await (await this.dlqProducer).send({
            topic: payload.batch.topic,
            messages: [message],
        });

        payload.resolveOffset(message.offset);
        await payload.heartbeat();
    }
}