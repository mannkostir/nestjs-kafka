import { DiscoveryModule } from '@golevelup/nestjs-discovery';
import { DynamicModule, Logger, Module, Provider } from '@nestjs/common';
import { Kafka, KafkaConfig } from 'kafkajs';
import { SchemaRegistryOptions, TransportConnectorModuleOptions } from './types/transport-connector-module-options.type';
import { ConsumerProxy } from './base/consumer-proxy';
import { KafkaConsumer } from './implementations/kafka/kafka-consumer';
import { KafkaProducer } from './implementations/kafka/kafka-producer';
import { ProducerProxy } from './base/producer-proxy';
import { SchemaRegistry } from '@kafkajs/confluent-schema-registry';

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
    schemaRegistryOptions: SchemaRegistryOptions,
    namespace?: string,
  ) => {
    return new KafkaConsumer(
      kafka,
      new SchemaRegistry({
        host: schemaRegistryOptions.url,
      }),
      namespace,
    );
  },
  inject: [Kafka, 'SCHEMA_REGISTRY_OPTIONS', 'TRANSPORT_NAMESPACE'],
};

const messageProducerProvider: Provider<ProducerProxy> = {
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

@Module({})
export class TransportConnectorModule {
  public static async register(
    options: TransportConnectorModuleOptions,
  ): Promise<DynamicModule> {
    return {
      module: TransportConnectorModule,
      imports: [DiscoveryModule],
      providers: [
        Logger,
        consumerProxyProvider,
        messageProducerProvider,
        {
          provide: 'TRANSPORT_CONFIG',
          useValue: options.clientOptions,
        },
        {
          provide: 'TRANSPORT_NAMESPACE',
          useValue: options.namespace,
        },
        {
          provide: 'SCHEMA_REGISTRY_OPTIONS',
          useValue: options.schemaRegistry,
        },
        kafkaProvider,
      ]
    };
  }
}
