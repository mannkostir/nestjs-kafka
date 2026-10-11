import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { Logger } from '@nestjs/common';
import { RetryHeaders } from './error-handle-strategies/retry-headers.js';
import { KafkaHandlerRoutes, RouteResolution } from './kafka-handler-routes.js';

export type DispatchedRoute = {
  handlerName: string;
  eachBatch: (payload: KafkaJS.EachBatchPayload) => Promise<void>;
};

type RecordRun<TRoute> = { resolution: RouteResolution<TRoute>; messages: KafkaJS.KafkaMessage[] };

export class KafkaSharedGroupDispatcher<TRoute extends DispatchedRoute> {
  constructor(
    private readonly routes: KafkaHandlerRoutes<TRoute>,
    private readonly sharedRetryTopics: ReadonlySet<string>,
    private readonly logger: Logger = new Logger(KafkaSharedGroupDispatcher.name),
  ) {}

  public async dispatch(payload: KafkaJS.EachBatchPayload): Promise<void> {
    if (this.sharedRetryTopics.has(payload.batch.topic)) {
      await this.dispatchRecords(payload);
      return;
    }

    const resolution = this.routes.resolve(payload.batch.topic);

    if (resolution.kind === 'owned') {
      await resolution.route.eachBatch(payload);
    } else {
      this.pause(payload, resolution.reason);
    }
  }

  private async dispatchRecords(payload: KafkaJS.EachBatchPayload): Promise<void> {
    for (const run of this.runsOf(payload)) {
      if (run.resolution.kind === 'unroutable') {
        this.pause(payload, run.resolution.reason);
        return;
      }

      const resolved = new Set<string>();
      await run.resolution.route.eachBatch(KafkaSharedGroupDispatcher.viewOf(payload, run.messages, resolved));

      if (!resolved.has(run.messages[run.messages.length - 1].offset)) {
        return;
      }
    }
  }

  private runsOf(payload: KafkaJS.EachBatchPayload): RecordRun<TRoute>[] {
    const runs: RecordRun<TRoute>[] = [];

    for (const message of payload.batch.messages) {
      const resolution = this.resolveRecord(payload.batch.topic, message);
      const last = runs[runs.length - 1];

      if (last && KafkaSharedGroupDispatcher.sameOwner(last.resolution, resolution)) {
        last.messages.push(message);
      } else {
        runs.push({ resolution, messages: [message] });
      }
    }

    return runs;
  }

  private resolveRecord(topic: string, message: KafkaJS.KafkaMessage): RouteResolution<TRoute> {
    const originalTopic = RetryHeaders.originalTopic(message);

    if (originalTopic === undefined) {
      return {
        kind: 'unroutable',
        reason: `Record at offset ${message.offset} of retry topic "${topic}" has no retry.original.topic header, so no handler can be chosen for it. Move the group's committed offset past it to resume.`,
      };
    }

    return this.routes.resolve(originalTopic);
  }

  private pause(payload: KafkaJS.EachBatchPayload, reason: string): void {
    const { topic, partition } = payload.batch;

    this.logger.error(`${reason} Partition ${partition} of "${topic}" is paused.`);
    this.pauseTolerantly(payload);
  }

  private pauseTolerantly(payload: KafkaJS.EachBatchPayload): void {
    try {
      payload.pause();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const { topic, partition } = payload.batch;
      this.logger.warn(`Could not pause topic "${topic}" partition ${partition}: ${reason}`);
    }
  }

  private static sameOwner<TRoute>(left: RouteResolution<TRoute>, right: RouteResolution<TRoute>): boolean {
    return left.kind === 'owned' && right.kind === 'owned' && left.route === right.route;
  }

  private static viewOf(
    payload: KafkaJS.EachBatchPayload,
    messages: KafkaJS.KafkaMessage[],
    resolved: Set<string>,
  ): KafkaJS.EachBatchPayload {
    return {
      ...payload,
      batch: { ...payload.batch, messages },
      resolveOffset: (offset: string) => {
        resolved.add(offset);
        payload.resolveOffset(offset);
      },
    };
  }
}
