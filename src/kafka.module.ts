import { DynamicModule, Module, Provider } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Kafka, KafkaConfig, Producer, Partitioners } from 'kafkajs';
import {
  SchemaRegistryOptions,
  KafkaModuleOptions,
  KafkaModuleAsyncOptions,
  KafkaModuleOptionsFactory,
} from './types/kafka-module-options.type';
import { ConsumerConfig } from './types/consumer-config.type';
import { ConsumerProxy } from './base/consumer-proxy';
import { KafkaConsumer } from './implementations/kafka/kafka-consumer';
import { KafkaProducer } from './implementations/kafka/kafka-producer';
import { ProducerProxy } from './base/producer-proxy';
import { TopicNamespacer } from './implementations/kafka/topic-namespacer';
import type { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { MessageHandlersDiscoveryService } from './services/message-handlers.discovery-service';
import {
  KAFKA_MODULE_OPTIONS,
  TRANSPORT_CONFIG,
  TRANSPORT_NAMESPACE,
  SCHEMA_REGISTRY_OPTIONS,
  CONSUMER_DEFAULTS,
  CONNECTOR_NAME,
  KAFKA_PRODUCER,
} from './tokens';

const kafkaProvider: Provider<Kafka> = {
  provide: Kafka,
  useFactory: (options: KafkaConfig) => {
    return new Kafka(options);
  },
  inject: [TRANSPORT_CONFIG],
};

const kafkaProducerProvider: Provider<Producer> = {
  provide: KAFKA_PRODUCER,
  useFactory: (kafka: Kafka) =>
    kafka.producer({
      allowAutoTopicCreation: true,
      createPartitioner: Partitioners.DefaultPartitioner,
    }),
  inject: [Kafka],
};

const consumerProxyProvider: Provider<ConsumerProxy> = {
  provide: ConsumerProxy,
  useFactory: (
    kafka: Kafka,
    producer: Producer,
    schemaRegistryOptions: SchemaRegistryOptions | undefined,
    namespace: string | undefined,
    consumerDefaults: ConsumerConfig | undefined,
    namespacer: TopicNamespacer,
  ) => {
    let schemaRegistry: SchemaRegistry | undefined;

    if (schemaRegistryOptions) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { SchemaRegistry } = require('@kafkajs/confluent-schema-registry');
      schemaRegistry = new SchemaRegistry({
        host: schemaRegistryOptions.url,
      });
    }

    return new KafkaConsumer(kafka, {
      schemaRegistry,
      namespace,
      producer,
      consumerDefaults,
      namespacer,
    });
  },
  inject: [Kafka, KAFKA_PRODUCER, SCHEMA_REGISTRY_OPTIONS, TRANSPORT_NAMESPACE, CONSUMER_DEFAULTS, TopicNamespacer],
};

const topicNamespacerProvider: Provider<TopicNamespacer> = {
  provide: TopicNamespacer,
  useFactory: (namespace?: string) => new TopicNamespacer(namespace),
  inject: [TRANSPORT_NAMESPACE],
};

const producerProxyProvider: Provider<ProducerProxy> = {
  provide: ProducerProxy,
  useFactory: async (producer: Producer, namespacer: TopicNamespacer) => {
    const proxy = new KafkaProducer(producer, namespacer);

    await proxy.connect();

    return proxy;
  },
  inject: [KAFKA_PRODUCER, TopicNamespacer],
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
        consumerProxyProvider,
        topicNamespacerProvider,
        producerProxyProvider,
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
        consumerProxyProvider,
        topicNamespacerProvider,
        producerProxyProvider,
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
