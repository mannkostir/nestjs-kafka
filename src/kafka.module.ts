import { DynamicModule, Module, Provider } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import {
  SchemaRegistryOptions,
  KafkaModuleOptions,
  KafkaModuleAsyncOptions,
  KafkaModuleOptionsFactory,
} from './types/kafka-module-options.type.js';
import { ConsumerConfig } from './types/consumer-config.type.js';
import { ProducerConfig } from './types/producer-config.type.js';
import { MessageType } from './types/message.type.js';
import { MessageFormat } from './types/message-format.type.js';
import { ConsumerProxy } from './base/consumer-proxy.js';
import { KafkaConsumer } from './implementations/kafka/kafka-consumer.js';
import { KafkaProducer } from './implementations/kafka/kafka-producer.js';
import { ProducerProxy } from './base/producer-proxy.js';
import { TopicNamespacer } from './implementations/kafka/topic-namespacer.js';
import { toClientProducerConfig } from './implementations/kafka/kafka-producer-config.js';
import type { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { MessageHandlersDiscoveryService } from './services/message-handlers.discovery-service.js';
import { KafkaConnections } from './implementations/kafka/kafka-connections.js';
import { IReleaseConnections } from './interfaces/release-connections.interface.js';
import {
  KAFKA_MODULE_OPTIONS,
  TRANSPORT_CONFIG,
  TRANSPORT_NAMESPACE,
  SCHEMA_REGISTRY_OPTIONS,
  SCHEMA_REGISTRY,
  CONSUMER_DEFAULTS,
  PRODUCER_CONFIG,
  CLIENT_LOGGER,
  CONNECTOR_NAME,
  KAFKA_PRODUCER,
  KAFKA_CONNECTIONS,
  MESSAGE_FORMAT,
  BATCH_CONSUMER,
  SHARED_GROUP_CONSUMER,
} from './tokens.js';

const kafkaProvider: Provider<KafkaJS.Kafka> = {
  provide: KafkaJS.Kafka,
  useFactory: (options: KafkaJS.CommonConstructorConfig) => {
    return new KafkaJS.Kafka(options);
  },
  inject: [TRANSPORT_CONFIG],
};

const kafkaProducerProvider: Provider<KafkaJS.Producer> = {
  provide: KAFKA_PRODUCER,
  useFactory: (
    kafka: KafkaJS.Kafka,
    producerConfig: ProducerConfig | undefined,
  ) => kafka.producer({ kafkaJS: toClientProducerConfig(producerConfig) }),
  inject: [KafkaJS.Kafka, PRODUCER_CONFIG],
};

const schemaRegistryProvider: Provider<SchemaRegistry | undefined> = {
  provide: SCHEMA_REGISTRY,
  useFactory: async (
    options: SchemaRegistryOptions | undefined,
  ): Promise<SchemaRegistry | undefined> => {
    if (!options) {
      return undefined;
    }

    const { SchemaRegistry } = await import('@kafkajs/confluent-schema-registry');

    return new SchemaRegistry({ host: options.url });
  },
  inject: [SCHEMA_REGISTRY_OPTIONS],
};

const batchConsumerProvider: Provider = {
  provide: BATCH_CONSUMER,
  useExisting: ConsumerProxy,
};

const sharedGroupConsumerProvider: Provider = {
  provide: SHARED_GROUP_CONSUMER,
  useExisting: ConsumerProxy,
};

const consumerProxyProvider: Provider<ConsumerProxy> = {
  provide: ConsumerProxy,
  useFactory: (
    kafka: KafkaJS.Kafka,
    producer: KafkaJS.Producer,
    schemaRegistry: SchemaRegistry | undefined,
    namespace: string | undefined,
    consumerDefaults: ConsumerConfig | undefined,
    namespacer: TopicNamespacer,
    clientLogger: KafkaJS.Logger | undefined,
    messageFormat: MessageFormat | undefined,
  ) =>
    new KafkaConsumer(kafka, {
      schemaRegistry,
      namespace,
      producer,
      consumerDefaults,
      namespacer,
      clientLogger,
      messageFormat,
    }),
  inject: [KafkaJS.Kafka, KAFKA_PRODUCER, SCHEMA_REGISTRY, TRANSPORT_NAMESPACE, CONSUMER_DEFAULTS, TopicNamespacer, CLIENT_LOGGER, MESSAGE_FORMAT],
};

const topicNamespacerProvider: Provider<TopicNamespacer> = {
  provide: TopicNamespacer,
  useFactory: (namespace?: string) => new TopicNamespacer(namespace),
  inject: [TRANSPORT_NAMESPACE],
};

const producerProxyProvider: Provider<ProducerProxy> = {
  provide: ProducerProxy,
  useFactory: async (
    producer: KafkaJS.Producer,
    namespacer: TopicNamespacer,
    messageFormat: MessageFormat | undefined,
    schemaRegistry: SchemaRegistry | undefined,
  ) => {
    const proxy = new KafkaProducer(producer, namespacer, { messageFormat, schemaRegistry });

    await proxy.connect();

    return proxy;
  },
  inject: [KAFKA_PRODUCER, TopicNamespacer, MESSAGE_FORMAT, SCHEMA_REGISTRY],
};

const kafkaConnectionsProvider: Provider<IReleaseConnections> = {
  provide: KAFKA_CONNECTIONS,
  useFactory: (
    consumer: KafkaConsumer<MessageType>,
    producer: KafkaProducer,
  ) => new KafkaConnections(consumer, producer),
  inject: [ConsumerProxy, ProducerProxy],
};

function rejectEmptyString(
  option: keyof KafkaModuleOptions,
  value: string | undefined,
  fix: string,
): string | undefined {
  if (value === '') {
    throw new Error(
      `KafkaModule "${option}" must not be an empty string. ${fix}`,
    );
  }

  return value;
}

function rejectUnknownMessageFormat(
  value: MessageFormat | undefined,
): MessageFormat | undefined {
  const formats: string[] = Object.values(MessageFormat);

  if (value !== undefined && !formats.includes(value)) {
    throw new Error(
      `KafkaModule "messageFormat" must be one of ${formats.join(', ')}. Use a MessageFormat value.`,
    );
  }

  return value;
}

function createDerivedProviders(): Provider[] {
  return [
    {
      provide: TRANSPORT_CONFIG,
      useFactory: (opts: KafkaModuleOptions) => opts.clientOptions,
      inject: [KAFKA_MODULE_OPTIONS],
    },
    {
      provide: TRANSPORT_NAMESPACE,
      useFactory: (opts: KafkaModuleOptions) =>
        rejectEmptyString(
          'namespace',
          opts.namespace,
          'Set a non-empty namespace, or leave it undefined to disable namespacing.',
        ),
      inject: [KAFKA_MODULE_OPTIONS],
    },
    {
      provide: SCHEMA_REGISTRY_OPTIONS,
      useFactory: (opts: KafkaModuleOptions) => opts.schemaRegistry,
      inject: [KAFKA_MODULE_OPTIONS],
    },
    {
      provide: CONNECTOR_NAME,
      useFactory: (opts: KafkaModuleOptions) =>
        rejectEmptyString(
          'connectorName',
          opts.connectorName,
          'Set a non-empty connectorName matching @Message({ connectorName }), or leave it undefined for the unnamed connector.',
        ),
      inject: [KAFKA_MODULE_OPTIONS],
    },
    {
      provide: CONSUMER_DEFAULTS,
      useFactory: (opts: KafkaModuleOptions) => opts.consumerDefaults,
      inject: [KAFKA_MODULE_OPTIONS],
    },
    {
      provide: PRODUCER_CONFIG,
      useFactory: (opts: KafkaModuleOptions) => opts.producer,
      inject: [KAFKA_MODULE_OPTIONS],
    },
    {
      provide: CLIENT_LOGGER,
      useFactory: (opts: KafkaModuleOptions) => opts.clientOptions.kafkaJS?.logger,
      inject: [KAFKA_MODULE_OPTIONS],
    },
    {
      provide: MESSAGE_FORMAT,
      useFactory: (opts: KafkaModuleOptions) =>
        rejectUnknownMessageFormat(opts.messageFormat),
      inject: [KAFKA_MODULE_OPTIONS],
    },
  ];
}

@Module({})
export class KafkaModule {
  public static register(
    options: KafkaModuleOptions,
  ): DynamicModule {
    return {
      module: KafkaModule,
      imports: [DiscoveryModule],
      providers: [
        {
          provide: KAFKA_MODULE_OPTIONS,
          useValue: options,
        },
        ...createDerivedProviders(),
        kafkaProvider,
        kafkaProducerProvider,
        schemaRegistryProvider,
        consumerProxyProvider,
        batchConsumerProvider,
        sharedGroupConsumerProvider,
        topicNamespacerProvider,
        producerProxyProvider,
        kafkaConnectionsProvider,
        MessageHandlersDiscoveryService,
      ],
      exports: [ConsumerProxy, ProducerProxy],
    };
  }

  public static registerAsync(
    asyncOptions: KafkaModuleAsyncOptions,
  ): DynamicModule {
    return {
      module: KafkaModule,
      imports: [...(asyncOptions.imports || []), DiscoveryModule],
      providers: [
        ...this.createAsyncOptionsProviders(asyncOptions),
        ...createDerivedProviders(),
        kafkaProvider,
        kafkaProducerProvider,
        schemaRegistryProvider,
        consumerProxyProvider,
        batchConsumerProvider,
        sharedGroupConsumerProvider,
        topicNamespacerProvider,
        producerProxyProvider,
        kafkaConnectionsProvider,
        MessageHandlersDiscoveryService,
      ],
      exports: [ConsumerProxy, ProducerProxy],
    };
  }

  private static createAsyncOptionsProviders(
    asyncOptions: KafkaModuleAsyncOptions,
  ): Provider[] {
    if (asyncOptions.useFactory) {
      return [
        {
          provide: KAFKA_MODULE_OPTIONS,
          useFactory: asyncOptions.useFactory,
          inject: asyncOptions.inject || [],
        },
      ];
    }

    if (asyncOptions.useClass) {
      return [
        {
          provide: asyncOptions.useClass,
          useClass: asyncOptions.useClass,
        },
        {
          provide: KAFKA_MODULE_OPTIONS,
          useFactory: (factory: KafkaModuleOptionsFactory) =>
            factory.createKafkaOptions(),
          inject: [asyncOptions.useClass],
        },
      ];
    }

    if (asyncOptions.useExisting) {
      return [
        {
          provide: KAFKA_MODULE_OPTIONS,
          useFactory: (factory: KafkaModuleOptionsFactory) =>
            factory.createKafkaOptions(),
          inject: [asyncOptions.useExisting],
        },
      ];
    }

    throw new Error(
      'One of useFactory, useClass, or useExisting must be provided in KafkaModuleAsyncOptions',
    );
  }
}
