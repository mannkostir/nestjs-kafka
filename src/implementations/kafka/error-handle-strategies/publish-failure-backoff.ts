import type { KafkaJS } from '@confluentinc/kafka-javascript';
import type { Logger } from '@nestjs/common';
import { describeFailure } from './failure-description.js';
import type { RedeliveryBackoff } from './redelivery-backoff.js';

export class PublishFailureBackoff {
  constructor(
    private readonly redelivery: RedeliveryBackoff,
    private readonly logger: Logger,
  ) {}

  public async run(
    payload: KafkaJS.EachBatchPayload,
    message: KafkaJS.KafkaMessage,
    publish: () => Promise<void>,
  ): Promise<void> {
    try {
      await publish();
    } catch (error) {
      this.postpone(payload, message, error);
      throw error;
    }
  }

  public stop(): void {
    this.redelivery.stop();
  }

  private postpone(payload: KafkaJS.EachBatchPayload, message: KafkaJS.KafkaMessage, error: unknown): void {
    const { topic, partition } = payload.batch;
    this.logger.warn(
      `Could not publish offset ${message.offset} of topic "${topic}" partition ${partition}: ${describeFailure(error).message}`,
    );
    this.redelivery.postpone(payload, message);
  }
}
