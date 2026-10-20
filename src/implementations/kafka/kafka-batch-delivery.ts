import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { Logger } from '@nestjs/common';
import { BatchFailure } from '../../errors/batch-failure.js';
import { MessageBatchHandlerCallback } from '../../types/message-batch-handler-callback.type.js';
import { KafkaMessage } from '../../types/message.type.js';
import { ReceivedMessage } from '../../types/received-message.type.js';
import { KafkaErrorHandleStrategy } from './error-handle-strategies/kafka-error-handle.strategy.js';
import { DecodedMessage } from './decoded-message.js';
import { messageContextOf } from './message-context-of.js';
import { KafkaMessageParseStrategy } from './parse-strategies/kafka-message-parse.strategy.js';

type CollectedMessage<TValue> = {
  record: KafkaJS.KafkaMessage;
  received: ReceivedMessage<TValue>;
};

type Remainder = (payload: KafkaJS.EachBatchPayload) => Promise<void>;

type CollectedBatch<TValue> = {
  messages: CollectedMessage<TValue>[];
  remainder?: Remainder;
};

export class KafkaBatchDelivery<TValue> {
  constructor(
    private readonly handler: MessageBatchHandlerCallback<TValue>,
    private readonly parseStrategy: KafkaMessageParseStrategy,
    private readonly errorStrategy: KafkaErrorHandleStrategy,
    private readonly groupId: string,
    private readonly logger: Logger = new Logger(KafkaBatchDelivery.name),
  ) {}

  public async deliver(payload: KafkaJS.EachBatchPayload): Promise<void> {
    const { messages, remainder } = await this.collect(payload);

    if (!KafkaBatchDelivery.isLive(payload)) {
      return;
    }

    try {
      await this.invoke(messages);
    } catch (error) {
      await this.fail(error, payload, messages);
      return;
    }

    messages.forEach(({ record }) => payload.resolveOffset(record.offset));

    if (remainder && KafkaBatchDelivery.isLive(payload)) {
      await remainder(payload);
    }
  }

  private async collect(payload: KafkaJS.EachBatchPayload): Promise<CollectedBatch<TValue>> {
    const messages: CollectedMessage<TValue>[] = [];

    for (const record of payload.batch.messages) {
      if (!KafkaBatchDelivery.isLive(payload)) {
        return { messages };
      }

      if (!this.errorStrategy.isDue(payload, record)) {
        return { messages, remainder: (live) => this.hold(live, record) };
      }

      try {
        messages.push({ record, received: await this.decode(payload.batch, record) });
      } catch (error) {
        return { messages, remainder: (live) => this.errorStrategy.handle(error, live, record) };
      }
    }

    return { messages };
  }

  private async decode(batch: KafkaJS.Batch, record: KafkaJS.KafkaMessage): Promise<ReceivedMessage<TValue>> {
    return {
      message: (await DecodedMessage.from(this.parseStrategy, record)) as KafkaMessage<TValue>,
      context: messageContextOf(batch, record),
    };
  }

  private async hold(payload: KafkaJS.EachBatchPayload, record: KafkaJS.KafkaMessage): Promise<void> {
    this.errorStrategy.holdUntilDue(payload, record);
  }

  private async invoke(messages: CollectedMessage<TValue>[]): Promise<void> {
    if (messages.length > 0) {
      await this.handler(messages.map(({ received }) => received));
    }
  }

  private async fail(error: unknown, payload: KafkaJS.EachBatchPayload, messages: CollectedMessage<TValue>[]): Promise<void> {
    if (error instanceof BatchFailure && error.index < messages.length) {
      messages.slice(0, error.index).forEach(({ record }) => payload.resolveOffset(record.offset));
      await this.errorStrategy.handle(error.cause, payload, messages[error.index].record);
      return;
    }

    if (error instanceof BatchFailure) {
      this.warnIndexPastEnd(error, messages.length);
    }

    await this.failAll(KafkaBatchDelivery.causeOf(error), payload, messages);
  }

  private warnIndexPastEnd(failure: BatchFailure, batchSize: number): void {
    this.logger.warn(
      `Batch handler of group "${this.groupId}" reported a failure at index ${failure.index}, but its batch held ${batchSize} messages. Applying the error policy to the whole batch.`,
    );
  }

  private async failAll(error: unknown, payload: KafkaJS.EachBatchPayload, messages: CollectedMessage<TValue>[]): Promise<void> {
    for (const { record } of messages) {
      await this.errorStrategy.handle(error, payload, record);
    }
  }

  private static causeOf(error: unknown): unknown {
    return error instanceof BatchFailure ? error.cause : error;
  }

  private static isLive(payload: KafkaJS.EachBatchPayload): boolean {
    return payload.isRunning() && !payload.isStale();
  }
}
