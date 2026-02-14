import { DiscoveryModule } from '@golevelup/nestjs-discovery';
import { DynamicModule, Logger, Module, Provider } from '@nestjs/common';
import { Kafka, KafkaConfig } from 'kafkajs';
import {
  SchemaRegistryOptions,
  TransportConnectorModuleOptions,
  TransportConnectorModuleAsyncOptions,
  TransportConnectorModuleOptionsFactory,
} from './types/transport-connector-module-options.type';
import { ConsumerProxy } from './base/consumer-proxy';
import { KafkaConsumer } from './implementations/kafka/kafka-consumer';
import { KafkaProducer } from './implementations/kafka/kafka-producer';
import { ProducerProxy } from './base/producer-proxy';
import type { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { MessageHandlersDiscoveryService } from './services/message-handlers.discovery-service';

export const TRANSPORT_CONNECTOR_OPTIONS = 'TRANSPORT_CONNECTOR_OPTIONS';

const kafkaProvider: Provider<Kafka> = {
  provide: Kafka,
  useFactory: (options: KafkaConfig) => {
    return new Kafka(options);
  },
  inject: ['TRANSPORT_CONFIG'],
};

const consumerProxyProvider: Provider<ConsumerProxy> = {
  provide: ConsumerProxy,
  useFactory: (
    kafka: Kafka,
    schemaRegistryOptions: SchemaRegistryOptions | undefined,
    namespace?: string,
  ) => {
    let schemaRegistry: SchemaRegistry | undefined;

    if (schemaRegistryOptions) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { SchemaRegistry } = require('@kafkajs/confluent-schema-registry');
      schemaRegistry = new SchemaRegistry({
        host: schemaRegistryOptions.url,
      });
    }

    return new KafkaConsumer(kafka, { schemaRegistry, namespace });
  },
  inject: [Kafka, 'SCHEMA_REGISTRY_OPTIONS', 'TRANSPORT_NAMESPACE'],
};

const producerProxyProvider: Provider<ProducerProxy> = {
  provide: ProducerProxy,
  useFactory: async (kafka: Kafka, namespace?: string) => {
    const producer = new KafkaProducer(kafka, namespace);

    try {
      await producer.connect();
    } catch (err) {
      throw err;
    }

    return producer;
  },
  inject: [Kafka, 'TRANSPORT_NAMESPACE'],
};

function createDerivedProviders(): Provider[] {
  return [
    {
      provide: 'TRANSPORT_CONFIG',
      useFactory: (opts: TransportConnectorModuleOptions) => opts.clientOptions,
      inject: [TRANSPORT_CONNECTOR_OPTIONS],
    },
    {
      provide: 'TRANSPORT_NAMESPACE',
      useFactory: (opts: TransportConnectorModuleOptions) => opts.namespace,
      inject: [TRANSPORT_CONNECTOR_OPTIONS],
    },
    {
      provide: 'SCHEMA_REGISTRY_OPTIONS',
      useFactory: (opts: TransportConnectorModuleOptions) => opts.schemaRegistry,
      inject: [TRANSPORT_CONNECTOR_OPTIONS],
    },
    {
      provide: 'module_name',
      useFactory: (opts: TransportConnectorModuleOptions) => opts.moduleName,
      inject: [TRANSPORT_CONNECTOR_OPTIONS],
    },
  ];
}

@Module({})
export class TransportConnectorModule {
  public static register(
    options: TransportConnectorModuleOptions,
  ): DynamicModule {
    return {
      module: TransportConnectorModule,
      imports: [DiscoveryModule],
      providers: [
        Logger,
        {
          provide: TRANSPORT_CONNECTOR_OPTIONS,
          useValue: options,
        },
        ...createDerivedProviders(),
        kafkaProvider,
        consumerProxyProvider,
        producerProxyProvider,
        MessageHandlersDiscoveryService,
      ],
      exports: [ConsumerProxy, ProducerProxy],
    };
  }

  public static registerAsync(
    asyncOptions: TransportConnectorModuleAsyncOptions,
  ): DynamicModule {
    return {
      module: TransportConnectorModule,
      imports: [...(asyncOptions.imports || []), DiscoveryModule],
      providers: [
        Logger,
        ...this.createAsyncOptionsProviders(asyncOptions),
        ...createDerivedProviders(),
        kafkaProvider,
        consumerProxyProvider,
        producerProxyProvider,
        MessageHandlersDiscoveryService,
      ],
      exports: [ConsumerProxy, ProducerProxy],
    };
  }

  private static createAsyncOptionsProviders(
    asyncOptions: TransportConnectorModuleAsyncOptions,
  ): Provider[] {
    if (asyncOptions.useFactory) {
      return [
        {
          provide: TRANSPORT_CONNECTOR_OPTIONS,
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
          provide: TRANSPORT_CONNECTOR_OPTIONS,
          useFactory: (factory: TransportConnectorModuleOptionsFactory) =>
            factory.createTransportConnectorOptions(),
          inject: [asyncOptions.useClass],
        },
      ];
    }

    if (asyncOptions.useExisting) {
      return [
        {
          provide: TRANSPORT_CONNECTOR_OPTIONS,
          useFactory: (factory: TransportConnectorModuleOptionsFactory) =>
            factory.createTransportConnectorOptions(),
          inject: [asyncOptions.useExisting],
        },
      ];
    }

    throw new Error(
      'One of useFactory, useClass, or useExisting must be provided in TransportConnectorModuleAsyncOptions',
    );
  }
}
