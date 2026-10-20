import type { KafkaJS } from '@confluentinc/kafka-javascript';
import type { Logger } from '@nestjs/common';
import { ExponentialBackoff } from './exponential-backoff.js';
import { PublishFailureBackoff } from './publish-failure-backoff.js';
import { RedeliveryBackoff } from './redelivery-backoff.js';

const record = (): KafkaJS.KafkaMessage => ({
  key: null,
  value: Buffer.from('{}'),
  timestamp: '0',
  size: 0,
  attributes: 0,
  offset: '7',
});

const batchPayload = (resume: () => void = jest.fn()) =>
  ({
    batch: { topic: 'orders.created', partition: 3 },
    pause: jest.fn(() => resume),
  }) as unknown as KafkaJS.EachBatchPayload;

const stubLogger = () => ({ warn: jest.fn() }) as unknown as Logger & { warn: jest.Mock };

const publishBackoff = (logger: Logger = stubLogger()) =>
  new PublishFailureBackoff(new RedeliveryBackoff(ExponentialBackoff.from({}, 'fail'), stubLogger()), logger);

const rejectedPublish = (error: unknown) => () => Promise.reject(error);

describe('PublishFailureBackoff', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves when the publish succeeds', async () => {
    await expect(publishBackoff().run(batchPayload(), record(), () => Promise.resolve())).resolves.toBeUndefined();
  });

  it('does not pause the partition when the publish succeeds', async () => {
    const payload = batchPayload();

    await publishBackoff().run(payload, record(), () => Promise.resolve());

    expect(payload.pause).not.toHaveBeenCalled();
  });

  it('pauses the partition when the publish is rejected', async () => {
    const payload = batchPayload();

    await publishBackoff().run(payload, record(), rejectedPublish(new Error('broker down'))).catch(() => undefined);

    expect(payload.pause).toHaveBeenCalledTimes(1);
  });

  it('rethrows the publish error unchanged', async () => {
    const failure = new Error('broker down');

    await expect(publishBackoff().run(batchPayload(), record(), rejectedPublish(failure))).rejects.toBe(failure);
  });

  it('warns once naming the offset, topic, partition and reason', async () => {
    const logger = stubLogger();

    await publishBackoff(logger).run(batchPayload(), record(), rejectedPublish(new Error('broker down'))).catch(() => undefined);

    expect(logger.warn.mock.calls).toEqual([
      ['Could not publish offset 7 of topic "orders.created" partition 3: broker down'],
    ]);
  });

  it('never resumes the partition after being stopped', async () => {
    const resume = jest.fn();
    const backoff = publishBackoff();
    await backoff.run(batchPayload(resume), record(), rejectedPublish(new Error('broker down'))).catch(() => undefined);

    backoff.stop();
    jest.advanceTimersByTime(30000);

    expect(resume).not.toHaveBeenCalled();
  });
});
