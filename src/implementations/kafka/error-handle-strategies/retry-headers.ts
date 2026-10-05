import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { describeFailure } from './failure-description.js';

export type RetryHopHeaders = { originalTopic: string; attempt: number; dueAt: number; error: unknown };

export class RetryHeaders {
  private static readonly ORIGINAL_TOPIC = 'retry.original.topic';
  private static readonly ATTEMPT = 'retry.attempt';
  private static readonly DUE = 'retry.due';
  private static readonly ERROR_NAME = 'retry.error.name';
  private static readonly ERROR_MESSAGE = 'retry.error.message';

  public static forHop(original: KafkaJS.IHeaders | undefined, hop: RetryHopHeaders): KafkaJS.IHeaders {
    const failure = describeFailure(hop.error);

    return {
      ...original,
      [RetryHeaders.ORIGINAL_TOPIC]: hop.originalTopic,
      [RetryHeaders.ATTEMPT]: String(hop.attempt),
      [RetryHeaders.DUE]: String(hop.dueAt),
      [RetryHeaders.ERROR_NAME]: failure.name,
      [RetryHeaders.ERROR_MESSAGE]: failure.message,
    };
  }

  public static dueAt(message: KafkaJS.KafkaMessage): number {
    const value = RetryHeaders.firstValue(message.headers, RetryHeaders.DUE);

    if (value === undefined || value.trim() === '') {
      return Number.NaN;
    }

    const num = Number(value);
    return Number.isFinite(num) ? num : Number.NaN;
  }

  private static firstValue(headers: KafkaJS.IHeaders | undefined, name: string): string | undefined {
    if (!headers) {
      return undefined;
    }

    const value = headers[name];

    if (value === undefined) {
      return undefined;
    }

    if (typeof value === 'string') {
      return value;
    }

    if (Buffer.isBuffer(value)) {
      return value.toString('utf-8');
    }

    if (Array.isArray(value)) {
      const first = value[0];
      if (typeof first === 'string') {
        return first;
      }
      if (Buffer.isBuffer(first)) {
        return first.toString('utf-8');
      }
    }

    return undefined;
  }
}
