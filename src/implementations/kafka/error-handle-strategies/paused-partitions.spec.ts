import type { KafkaJS } from '@confluentinc/kafka-javascript';
import type { Logger } from '@nestjs/common';
import { PausedPartitions } from './paused-partitions.js';

const batchPayload = (partition: number, resume: () => void) =>
  ({
    batch: { topic: 'orders.created', partition },
    pause: jest.fn(() => resume),
  }) as unknown as KafkaJS.EachBatchPayload;

const unpausablePayload = () =>
  ({
    batch: { topic: 'orders.created', partition: 0 },
    pause: jest.fn(() => undefined),
  }) as unknown as KafkaJS.EachBatchPayload;

const throwingPausePayload = (error: Error) =>
  ({
    batch: { topic: 'orders.created', partition: 0 },
    pause: jest.fn(() => {
      throw error;
    }),
  }) as unknown as KafkaJS.EachBatchPayload;

const throwingResume = (error: Error) => () => {
  throw error;
};

const stubLogger = () => ({ warn: jest.fn() }) as unknown as Logger & { warn: jest.Mock };

describe('PausedPartitions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('pauses the partition and reports it paused', () => {
    const payload = batchPayload(0, jest.fn());

    expect(new PausedPartitions(stubLogger()).pauseFor(payload, 1000)).toBe(true);
  });

  it('resumes the partition once the delay elapses', () => {
    const resume = jest.fn();
    new PausedPartitions(stubLogger()).pauseFor(batchPayload(0, resume), 1000);

    jest.advanceTimersByTime(1000);

    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('does not resume before the delay elapses', () => {
    const resume = jest.fn();
    new PausedPartitions(stubLogger()).pauseFor(batchPayload(0, resume), 1000);

    jest.advanceTimersByTime(999);

    expect(resume).not.toHaveBeenCalled();
  });

  it('reports not paused when the client gives no resume function', () => {
    expect(new PausedPartitions(stubLogger()).pauseFor(unpausablePayload(), 1000)).toBe(false);
  });

  it('reports not paused when pausing throws', () => {
    const payload = throwingPausePayload(new Error('Pause can only be called while connected.'));

    expect(new PausedPartitions(stubLogger()).pauseFor(payload, 1000)).toBe(false);
  });

  it('warns when pausing throws', () => {
    const logger = stubLogger();
    const payload = throwingPausePayload(new Error('Pause can only be called while connected.'));

    new PausedPartitions(logger).pauseFor(payload, 1000);

    expect(logger.warn).toHaveBeenCalledWith(
      'Could not pause topic "orders.created" partition 0 for backoff: Pause can only be called while connected.',
    );
  });

  it('warns when resuming throws', () => {
    const logger = stubLogger();
    const payload = batchPayload(0, throwingResume(new Error('Resume failed.')));
    new PausedPartitions(logger).pauseFor(payload, 1000);

    jest.advanceTimersByTime(1000);

    expect(logger.warn).toHaveBeenCalledWith(
      'Could not resume topic "orders.created" partition 0 after backoff: Resume failed.',
    );
  });

  it('never resumes after stop', () => {
    const resume = jest.fn();
    const partitions = new PausedPartitions(stubLogger());
    partitions.pauseFor(batchPayload(0, resume), 1000);

    partitions.stop();
    jest.advanceTimersByTime(1000);

    expect(resume).not.toHaveBeenCalled();
  });

  it('does not pause after stop', () => {
    const partitions = new PausedPartitions(stubLogger());
    partitions.stop();
    const payload = batchPayload(0, jest.fn());

    partitions.pauseFor(payload, 1000);

    expect(payload.pause).not.toHaveBeenCalled();
  });
});
