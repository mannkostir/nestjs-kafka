import { Kafka, Producer, RecordMetadata } from 'kafkajs';
import { ProducerProxy } from '../../base/producer-proxy';
import { MessageType } from '../../types/message.type';

export class KafkaProducer<
  TPayload extends Record<string, any>,
> extends ProducerProxy<TPayload> {
  producer: Producer;
  constructor(
    kafka: Kafka,
    private readonly namespace?: string,
  ) {
    super();
    this.producer = kafka.producer({
      allowAutoTopicCreation: true,
    });
  }

  public async connect(): Promise<void> {
    return this.producer.connect();
  }

  public async send(
    topic: string,
    message: MessageType<TPayload>,
    key?: string,
  ): Promise<RecordMetadata[]> {
    return this.producer.send({
      topic: this.namespace ? `${this.namespace}.${topic}` : topic,
      messages: [
        {
          value: JSON.stringify(message.value),
          headers: message.headers,
          key: key,
        },
      ],
    });
  }
}
