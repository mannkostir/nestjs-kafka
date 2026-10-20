import { IReleaseConnections } from '../../interfaces/release-connections.interface.js';
import { MessageType } from '../../types/message.type.js';
import { KafkaConsumer } from './kafka-consumer.js';
import { KafkaProducer } from './kafka-producer.js';

export class KafkaConnections implements IReleaseConnections {
  constructor(
    private readonly consumer: KafkaConsumer<MessageType>,
    private readonly producer: KafkaProducer<Record<string, unknown>>,
  ) {}

  private released?: Promise<void>;

  releaseConnections(): Promise<void> {
    this.released ??= this.release();

    return this.released;
  }

  private async release(): Promise<void> {
    await this.consumer.disconnectAll();
    await this.producer.disconnect();
  }
}
