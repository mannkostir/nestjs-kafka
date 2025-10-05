import { KafkaConfig } from 'kafkajs';

export type TransportConnectorModuleOptions = {
  clientOptions: KafkaConfig;
  namespace?: string;
};
