import type { KafkaJS } from '@confluentinc/kafka-javascript';
import type { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { BeforeApplicationShutdown, Logger } from '@nestjs/common';
import { ProducerProxy } from '../../base/producer-proxy.js';
import { MessageFormat } from '../../types/message-format.type.js';
import { KafkaMessage } from '../../types/message.type.js';
import { ProducedRecord } from '../../types/produced-record.type.js';
import { ProducerSendOptions } from '../../types/producer-send-options.type.js';
import { toProducedRecord } from './kafka-produced-record.js';
import { encodeKey } from './serialize-strategies/encode-key.js';
import { KafkaMessageSerializeStrategyFactory } from './serialize-strategies/kafka-message-serialize-strategy.factory.js';
import { TopicNamespacer } from './topic-namespacer.js';
import { ConnectorHealthState } from '../../health/connector-health-state.js';

export interface KafkaProducerOptions {
  messageFormat?: MessageFormat;
  schemaRegistry?: SchemaRegistry;
  latestSchemaTtl?: number;
  health?: ConnectorHealthState;
}

export class KafkaProducer extends ProducerProxy implements BeforeApplicationShutdown {

  private readonly logger = new Logger(KafkaProducer.name);
  private connectionAttempt = 0;
  private readonly health: ConnectorHealthState;
  private readonly messageFormat: MessageFormat;
  private readonly serializeStrategies: KafkaMessageSerializeStrategyFactory;

  constructor(
    private readonly producer: KafkaJS.Producer,
    private readonly namespacer: TopicNamespacer,
    options?: KafkaProducerOptions,
  ) {
    super();
    this.health = options?.health ?? new ConnectorHealthState();
    this.messageFormat = options?.messageFormat ?? MessageFormat.JSON;
    this.serializeStrategies = new KafkaMessageSerializeStrategyFactory(options?.schemaRegistry, {
      latestSchemaTtl: options?.latestSchemaTtl,
    });
  }

  public async connect(): Promise<void> {
    const attempt = ++this.connectionAttempt;
    this.health.producerConnected = false;
    await this.producer.connect();
    if (attempt === this.connectionAttempt) {
      this.health.producerConnected = true;
    }
  }

  public async send<TValue>(
    topic: string,
    message: KafkaMessage<TValue>,
    options?: ProducerSendOptions,
  ): Promise<ProducedRecord[]> {
    const namespaced = options?.namespaced ?? true;
    const finalTopic = namespaced ? this.namespacer.apply(topic) : topic;
    const serializeStrategy = this.serializeStrategies.create(
      options?.messageFormat ?? this.messageFormat,
      { topic: finalTopic, schemaId: options?.schemaId, subject: options?.subject },
    );

    const delivered = await this.producer.send({
      topic: finalTopic,
      messages: [
        {
          value: await serializeStrategy.serialize(message.value),
          headers: message.headers,
          key: encodeKey(message.key),
        },
      ],
    });

    return delivered.map(toProducedRecord);
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.disconnect();
  }

  public async disconnect(): Promise<void> {
    ++this.connectionAttempt;
    this.health.producerConnected = false;
    this.logger.log('Disconnecting producer...');

    try {
      await this.producer.disconnect();
    } catch (err) {
      this.logger.error('Error disconnecting producer', err);
    }

    this.logger.log('Producer disconnected');
  }
}
