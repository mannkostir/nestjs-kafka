import type {
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency,
  Type,
} from '@nestjs/common';
import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { ConsumerConfig } from './consumer-config.type.js';
import { ProducerConfig } from './producer-config.type.js';
import { MessageFormat } from './message-format.type.js';

export type SchemaRegistryOptions = {
  url: string;
};

export type KafkaModuleOptions = {
  clientOptions: KafkaJS.CommonConstructorConfig;
  namespace?: string;
  connectorName?: string;
  schemaRegistry?: {
    url: string;
  };
  consumerDefaults?: ConsumerConfig;
  producer?: ProducerConfig;
  messageFormat?: MessageFormat;
};

export interface KafkaModuleOptionsFactory {
  createKafkaOptions():
    | KafkaModuleOptions
    | Promise<KafkaModuleOptions>;
}

export interface KafkaModuleAsyncOptions
  extends Pick<ModuleMetadata, 'imports'> {
  inject?: Array<InjectionToken | OptionalFactoryDependency>;
  useFactory?: (
    ...args: any[]
  ) =>
    | KafkaModuleOptions
    | Promise<KafkaModuleOptions>;
  useClass?: Type<KafkaModuleOptionsFactory>;
  useExisting?: Type<KafkaModuleOptionsFactory>;
}
