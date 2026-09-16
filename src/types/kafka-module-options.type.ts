import { ModuleMetadata, Type } from '@nestjs/common';
import { KafkaConfig } from 'kafkajs';
import { ConsumerConfig } from './consumer-config.type';

export type SchemaRegistryOptions = {
  url: string;
};

export type KafkaModuleOptions = {
  clientOptions: KafkaConfig;
  namespace?: string;
  connectorName?: string;
  schemaRegistry?: {
    url: string;
  };
  consumerDefaults?: ConsumerConfig;
};

export interface KafkaModuleOptionsFactory {
  createKafkaOptions():
    | KafkaModuleOptions
    | Promise<KafkaModuleOptions>;
}

export interface KafkaModuleAsyncOptions
  extends Pick<ModuleMetadata, 'imports'> {
  inject?: any[];
  useFactory?: (
    ...args: any[]
  ) =>
    | KafkaModuleOptions
    | Promise<KafkaModuleOptions>;
  useClass?: Type<KafkaModuleOptionsFactory>;
  useExisting?: Type<KafkaModuleOptionsFactory>;
}
