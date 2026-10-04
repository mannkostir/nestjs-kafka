import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { BeforeApplicationShutdown, Logger } from '@nestjs/common';
import { ProducerProxy } from '../../base/producer-proxy.js';
import { MessageFormat } from '../../types/message-format.type.js';
import { MessageType } from '../../types/message.type.js';
import { ProducerSendOptions } from '../../types/producer-send-options.type.js';
import { encodeKey } from './serialize-strategies/encode-key.js';
import { KafkaMessageSerializeStrategyFactory } from './serialize-strategies/kafka-message-serialize-strategy.factory.js';
import { TopicNamespacer } from './topic-namespacer.js';

export interface KafkaProducerOptions {
  messageFormat?: MessageFormat;
}

export class KafkaProducer<TValue = unknown> extends ProducerProxy<TValue> implements BeforeApplicationShutdown {

  private readonly logger = new Logger(KafkaProducer.name);
  private readonly messageFormat: MessageFormat;
  private readonly serializeStrategies = new KafkaMessageSerializeStrategyFactory();

  constructor(
    private readonly producer: KafkaJS.Producer,
    private readonly namespacer: TopicNamespacer,
    options?: KafkaProducerOptions,
  ) {
    super();
    this.messageFormat = options?.messageFormat ?? MessageFormat.JSON;
  }

  public async connect(): Promise<void> {
    return this.producer.connect();
  }

  public async send(
    topic: string,
    message: MessageType<TValue>,
    options?: ProducerSendOptions,
  ): Promise<KafkaJS.RecordMetadata[]> {
    const namespaced = options?.namespaced ?? true;
    const finalTopic = namespaced ? this.namespacer.apply(topic) : topic;
    const serializeStrategy = this.serializeStrategies.create(
      options?.messageFormat ?? this.messageFormat,
      { topic: finalTopic },
    );

    return this.producer.send({
      topic: finalTopic,
      messages: [
        {
          value: await serializeStrategy.serialize(message.value),
          headers: message.headers,
          key: encodeKey(message.key),
        },
      ],
    });
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.disconnect();
  }

  public async disconnect(): Promise<void> {
    this.logger.log('Disconnecting producer...');

    try {
      await this.producer.disconnect();
    } catch (err) {
      this.logger.error('Error disconnecting producer', err);
    }

    this.logger.log('Producer disconnected');
  }
}
