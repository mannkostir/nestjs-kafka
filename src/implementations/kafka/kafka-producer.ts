import { Producer, RecordMetadata } from 'kafkajs';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { ProducerProxy } from '../../base/producer-proxy';
import { MessageType } from '../../types/message.type';
import { ProducerSendOptions } from '../../types/producer-send-options.type';
import { TopicNamespacer } from './topic-namespacer';

export class KafkaProducer<
  TPayload extends Record<string, any>,
> extends ProducerProxy<TPayload> implements OnModuleDestroy {

  private readonly logger = new Logger(KafkaProducer.name);

  constructor(
    private readonly producer: Producer,
    private readonly namespacer: TopicNamespacer,
  ) {
    super();
  }

  public async connect(): Promise<void> {
    return this.producer.connect();
  }

  public async send(
    topic: string,
    message: MessageType<TPayload>,
    options?: ProducerSendOptions,
  ): Promise<RecordMetadata[]> {
    const namespaced = options?.namespaced ?? true;

    return this.producer.send({
      topic: namespaced ? this.namespacer.apply(topic) : topic,
      messages: [
        {
          value: JSON.stringify(message.value),
          headers: message.headers,
          key: options?.key,
        },
      ],
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Disconnecting producer...');

    try {
      await this.producer.disconnect();
    } catch (err) {
      this.logger.error('Error disconnecting producer', err);
    }

    this.logger.log('Producer disconnected');
  }
}
