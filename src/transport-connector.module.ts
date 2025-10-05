import { DiscoveryModule } from '@golevelup/nestjs-discovery';
import { SchemaRegistry } from '@kafkajs/confluent-schema-registry';
import { DynamicModule, Logger, Module, Provider } from '@nestjs/common';
import { Kafka, KafkaConfig } from 'kafkajs';
import { TransportConnectorModuleOptions } from './types/transport-connector-module-options.type';

const kafkaProvider: Provider<Kafka> = {
  provide: Kafka,
  useFactory: (options: KafkaConfig) => {
    return new Kafka(options);
  },
  inject: ['TRANSPORT_CONFIG'],
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
        {
          provide: 'TRANSPORT_CONFIG',
          useValue: options.clientOptions,
        },
        {
          provide: 'TRANSPORT_NAMESPACE',
          useValue: options.namespace,
        },
        kafkaProvider,
      ]
    };
  }
}
