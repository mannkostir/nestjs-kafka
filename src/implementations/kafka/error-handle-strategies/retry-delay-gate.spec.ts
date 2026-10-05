import type { KafkaJS } from '@confluentinc/kafka-javascript';
import type { Logger } from '@nestjs/common';
import { PausedPartitions } from './paused-partitions.js';
import { RetryDelayGate } from './retry-delay-gate.js';
import { RetryTopics } from './retry-topics.js';

const stubLogger = () => ({ warn: jest.fn() }) as unknown as Logger & { warn: jest.Mock };

const payloadOn = (topic: string, resume: () => void) =>
  ({
    batch: { topic, partition: 0 },
    pause: jest.fn(() => resume),
  }) as unknown as KafkaJS.EachBatchPayload;

const dueMessage = (due?: string) => ({
  headers: due !== undefined ? { 'retry.due': due } : undefined,
});

const gate = () => new RetryDelayGate(RetryTopics.for('svc', 2), new PausedPartitions(stubLogger()), () => 1000);

describe('RetryDelayGate', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('holds a retry message that is not due yet', () => {
    expect(gate().holdUntilDue(payloadOn('orders.created.svc.retry.1', jest.fn()), dueMessage('1500') as unknown as KafkaJS.KafkaMessage)).toBe(true);
  });

  it('resumes the retry partition when the message falls due', () => {
    const resume = jest.fn();
    gate().holdUntilDue(payloadOn('orders.created.svc.retry.1', resume), dueMessage('1500') as unknown as KafkaJS.KafkaMessage);

    jest.advanceTimersByTime(500);

    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('lets a due retry message through', () => {
    expect(gate().holdUntilDue(payloadOn('orders.created.svc.retry.1', jest.fn()), dueMessage('1000') as unknown as KafkaJS.KafkaMessage)).toBe(false);
  });

  it('lets a retry message without a due time through', () => {
    expect(gate().holdUntilDue(payloadOn('orders.created.svc.retry.1', jest.fn()), dueMessage() as unknown as KafkaJS.KafkaMessage)).toBe(false);
  });

  it('never holds a source topic message, whatever its headers say', () => {
    const payload = payloadOn('orders.created', jest.fn());

    gate().holdUntilDue(payload, dueMessage('999999') as unknown as KafkaJS.KafkaMessage);

    expect(payload.pause).not.toHaveBeenCalled();
  });

  it('caps a wait too long for a timer', () => {
    const resume = jest.fn();
    gate().holdUntilDue(payloadOn('orders.created.svc.retry.1', resume), dueMessage(String(Number.MAX_SAFE_INTEGER)) as unknown as KafkaJS.KafkaMessage);

    jest.advanceTimersByTime(2147483647);

    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('lets the message through when the partition cannot be paused', () => {
    const payload = { batch: { topic: 'orders.created.svc.retry.1', partition: 0 }, pause: jest.fn(() => undefined) };

    expect(gate().holdUntilDue(payload as unknown as KafkaJS.EachBatchPayload, dueMessage('1500') as unknown as KafkaJS.KafkaMessage)).toBe(false);
  });

  it('never resumes after stop', () => {
    const resume = jest.fn();
    const subject = gate();
    subject.holdUntilDue(payloadOn('orders.created.svc.retry.1', resume), dueMessage('1500') as unknown as KafkaJS.KafkaMessage);

    subject.stop();
    jest.advanceTimersByTime(500);

    expect(resume).not.toHaveBeenCalled();
  });
});

describe('RetryDelayGate.isDue', () => {
  const asMessage = (message: ReturnType<typeof dueMessage>) => message as unknown as KafkaJS.KafkaMessage;

  it('treats a source topic message as due, whatever its headers say', () => {
    expect(gate().isDue(payloadOn('orders.created', jest.fn()), asMessage(dueMessage('999999')))).toBe(true);
  });

  it('treats a retry message whose due time has passed as due', () => {
    expect(gate().isDue(payloadOn('orders.created.svc.retry.1', jest.fn()), asMessage(dueMessage('1000')))).toBe(true);
  });

  it('treats a retry message without a due time as due', () => {
    expect(gate().isDue(payloadOn('orders.created.svc.retry.1', jest.fn()), asMessage(dueMessage()))).toBe(true);
  });

  it('treats a retry message whose due time is ahead as not due', () => {
    expect(gate().isDue(payloadOn('orders.created.svc.retry.1', jest.fn()), asMessage(dueMessage('1500')))).toBe(false);
  });

  it('does not pause the partition', () => {
    const payload = payloadOn('orders.created.svc.retry.1', jest.fn());

    gate().isDue(payload, asMessage(dueMessage('1500')));

    expect(payload.pause).not.toHaveBeenCalled();
  });
});
