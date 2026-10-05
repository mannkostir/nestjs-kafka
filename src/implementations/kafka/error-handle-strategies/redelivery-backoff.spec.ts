import type { KafkaJS } from '@confluentinc/kafka-javascript';
import type { Logger } from '@nestjs/common';
import { ExponentialBackoff } from './exponential-backoff.js';
import { RedeliveryBackoff } from './redelivery-backoff.js';

const record = (offset: string): KafkaJS.KafkaMessage => ({
  key: null,
  value: Buffer.from('{}'),
  timestamp: '0',
  size: 0,
  attributes: 0,
  offset,
});

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

const stubLogger = () => ({ warn: jest.fn() }) as unknown as Logger & { warn: jest.Mock };

const defaultBackoff = () => ExponentialBackoff.from({}, 'fail');

describe('RedeliveryBackoff', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('pauses the failing partition', () => {
    const redelivery = new RedeliveryBackoff(defaultBackoff(), stubLogger());
    const payload = batchPayload(0, jest.fn());

    redelivery.postpone(payload, record('7'));

    expect(payload.pause).toHaveBeenCalledTimes(1);
  });

  it('does not resume before the delay elapses', () => {
    const redelivery = new RedeliveryBackoff(defaultBackoff(), stubLogger());
    const resume = jest.fn();

    redelivery.postpone(batchPayload(0, resume), record('7'));
    jest.advanceTimersByTime(299);

    expect(resume).not.toHaveBeenCalled();
  });

  it('resumes the partition once the delay elapses', () => {
    const redelivery = new RedeliveryBackoff(defaultBackoff(), stubLogger());
    const resume = jest.fn();

    redelivery.postpone(batchPayload(0, resume), record('7'));
    jest.advanceTimersByTime(300);

    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('warns with the topic, partition, offset and delay', () => {
    const logger = stubLogger();
    const redelivery = new RedeliveryBackoff(defaultBackoff(), logger);

    redelivery.postpone(batchPayload(3, jest.fn()), record('7'));

    expect(logger.warn).toHaveBeenCalledWith(
      'Pausing topic "orders.created" partition 3 for 300 ms before redelivering offset 7.',
    );
  });

  it('lengthens the delay when the same offset fails again', () => {
    const redelivery = new RedeliveryBackoff(defaultBackoff(), stubLogger());
    const resume = jest.fn();
    redelivery.postpone(batchPayload(0, jest.fn()), record('7'));
    jest.advanceTimersByTime(300);

    redelivery.postpone(batchPayload(0, resume), record('7'));
    jest.advanceTimersByTime(599);

    expect(resume).not.toHaveBeenCalled();
  });

  it('resumes after the lengthened delay when the same offset fails again', () => {
    const redelivery = new RedeliveryBackoff(defaultBackoff(), stubLogger());
    const resume = jest.fn();
    redelivery.postpone(batchPayload(0, jest.fn()), record('7'));
    jest.advanceTimersByTime(300);

    redelivery.postpone(batchPayload(0, resume), record('7'));
    jest.advanceTimersByTime(600);

    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('restarts from initialMs when a different offset fails', () => {
    const redelivery = new RedeliveryBackoff(defaultBackoff(), stubLogger());
    const resume = jest.fn();
    redelivery.postpone(batchPayload(0, jest.fn()), record('7'));
    jest.advanceTimersByTime(300);

    redelivery.postpone(batchPayload(0, resume), record('8'));
    jest.advanceTimersByTime(300);

    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('tracks attempts independently per partition', () => {
    const redelivery = new RedeliveryBackoff(defaultBackoff(), stubLogger());
    const resume = jest.fn();
    redelivery.postpone(batchPayload(0, jest.fn()), record('7'));
    jest.advanceTimersByTime(300);

    redelivery.postpone(batchPayload(1, resume), record('7'));
    jest.advanceTimersByTime(300);

    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('never resumes after being stopped', () => {
    const redelivery = new RedeliveryBackoff(defaultBackoff(), stubLogger());
    const resume = jest.fn();
    redelivery.postpone(batchPayload(0, resume), record('7'));

    redelivery.stop();
    jest.advanceTimersByTime(30000);

    expect(resume).not.toHaveBeenCalled();
  });

  it('schedules no resume once stopped', () => {
    const redelivery = new RedeliveryBackoff(defaultBackoff(), stubLogger());
    redelivery.stop();

    redelivery.postpone(batchPayload(0, jest.fn()), record('7'));

    expect(jest.getTimerCount()).toBe(0);
  });

  it('pauses no partition once stopped', () => {
    const redelivery = new RedeliveryBackoff(defaultBackoff(), stubLogger());
    const payload = batchPayload(0, jest.fn());
    redelivery.stop();

    redelivery.postpone(payload, record('7'));

    expect(payload.pause).not.toHaveBeenCalled();
  });

  it('logs a resume failure instead of throwing it', () => {
    const logger = stubLogger();
    const redelivery = new RedeliveryBackoff(defaultBackoff(), logger);
    redelivery.postpone(
      batchPayload(0, () => {
        throw new Error('partition revoked');
      }),
      record('7'),
    );

    jest.advanceTimersByTime(300);

    expect(logger.warn).toHaveBeenLastCalledWith(
      'Could not resume topic "orders.created" partition 0 after backoff: partition revoked',
    );
  });

  it('logs a pause failure instead of throwing it', () => {
    const logger = stubLogger();
    const redelivery = new RedeliveryBackoff(defaultBackoff(), logger);
    const payload = {
      batch: { topic: 'orders.created', partition: 0 },
      pause: jest.fn(() => {
        throw new Error('Pause can only be called while connected.');
      }),
    } as unknown as KafkaJS.EachBatchPayload;

    redelivery.postpone(payload, record('7'));

    expect(logger.warn).toHaveBeenLastCalledWith(
      'Could not pause topic "orders.created" partition 0 for backoff: Pause can only be called while connected.',
    );
  });

  it('schedules nothing when the client pauses no partition', () => {
    const redelivery = new RedeliveryBackoff(defaultBackoff(), stubLogger());

    redelivery.postpone(unpausablePayload(), record('7'));

    expect(jest.getTimerCount()).toBe(0);
  });

  describe('with failures interleaved across two partitions', () => {
    const interleave = () => {
      const logger = stubLogger();
      const redelivery = new RedeliveryBackoff(defaultBackoff(), logger);
      const first = batchPayload(0, jest.fn());
      const second = batchPayload(1, jest.fn());
      redelivery.postpone(first, record('5'));
      redelivery.postpone(second, record('9'));
      redelivery.postpone(first, record('5'));
      redelivery.postpone(second, record('9'));
      return { logger, redelivery, first, second };
    };

    it('advances the attempt count of each partition independently', () => {
      const { logger } = interleave();

      expect(logger.warn).toHaveBeenNthCalledWith(
        1,
        'Pausing topic "orders.created" partition 0 for 300 ms before redelivering offset 5.',
      );
      expect(logger.warn).toHaveBeenNthCalledWith(
        2,
        'Pausing topic "orders.created" partition 1 for 300 ms before redelivering offset 9.',
      );
      expect(logger.warn).toHaveBeenNthCalledWith(
        3,
        'Pausing topic "orders.created" partition 0 for 600 ms before redelivering offset 5.',
      );
      expect(logger.warn).toHaveBeenNthCalledWith(
        4,
        'Pausing topic "orders.created" partition 1 for 600 ms before redelivering offset 9.',
      );
    });

    it('pauses each payload only for its own failures', () => {
      const { first, second } = interleave();

      expect(first.pause).toHaveBeenCalledTimes(2);
      expect(second.pause).toHaveBeenCalledTimes(2);
    });

    it('resumes only the partition whose delay elapsed', () => {
      const redelivery = new RedeliveryBackoff(defaultBackoff(), stubLogger());
      const resumeFirst = jest.fn();
      const resumeSecond = jest.fn();
      redelivery.postpone(batchPayload(0, resumeFirst), record('5'));
      jest.advanceTimersByTime(100);
      redelivery.postpone(batchPayload(1, resumeSecond), record('9'));

      jest.advanceTimersByTime(200);

      expect(resumeFirst).toHaveBeenCalledTimes(1);
      expect(resumeSecond).not.toHaveBeenCalled();
    });

    it('cancels the pending resumes of both partitions when stopped', () => {
      const redelivery = new RedeliveryBackoff(defaultBackoff(), stubLogger());
      const resumeFirst = jest.fn();
      const resumeSecond = jest.fn();
      redelivery.postpone(batchPayload(0, resumeFirst), record('5'));
      redelivery.postpone(batchPayload(1, resumeSecond), record('9'));

      redelivery.stop();
      jest.advanceTimersByTime(30000);

      expect(resumeFirst).not.toHaveBeenCalled();
      expect(resumeSecond).not.toHaveBeenCalled();
    });
  });
});
