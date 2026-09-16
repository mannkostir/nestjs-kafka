import { ModuleMetadata, Type } from '@nestjs/common';
import { KafkaConfig } from 'kafkajs';
import { ConsumerConfig } from './consumer-config.type';

export type SchemaRegistryOptions = {
  url: string;
};

export type TransportConnectorModuleOptions = {
  clientOptions: KafkaConfig;
  namespace?: string;
  connectorName?: string;
  schemaRegistry?: {
    url: string;
  };
  consumerDefaults?: ConsumerConfig;
};

export interface TransportConnectorModuleOptionsFactory {
  createTransportConnectorOptions():
    | TransportConnectorModuleOptions
    | Promise<TransportConnectorModuleOptions>;
}

export interface TransportConnectorModuleAsyncOptions
  extends Pick<ModuleMetadata, 'imports'> {
  inject?: any[];
  useFactory?: (
    ...args: any[]
  ) =>
    | TransportConnectorModuleOptions
    | Promise<TransportConnectorModuleOptions>;
  useClass?: Type<TransportConnectorModuleOptionsFactory>;
  useExisting?: Type<TransportConnectorModuleOptionsFactory>;
}
