import { KafkaConfig } from 'kafkajs';

export type SchemaRegistryOptions = {
  url: string;
};

export type TransportConnectorModuleOptions = {
  clientOptions: KafkaConfig;
  namespace?: string;
  moduleName: string;
  schemaRegistry?: {
    url: string;
  };
};
