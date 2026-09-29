import { KafkaJS } from '@confluentinc/kafka-javascript';
import { JoinFailureDetector } from './join-failure-detector.js';

const innerLogger = () => {
  const logger: jest.Mocked<KafkaJS.Logger> = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    namespace: jest.fn(),
    setLogLevel: jest.fn(),
  };
  return logger;
};

const groupAuthorizationMessage =
  'Consumer encountered error while consuming. Retrying. Error details: KafkaJSProtocolError: Broker: Group authorization failed : Error: Broker: Group authorization failed\n    at KafkaConsumer._consumeSingle (node_modules/@confluentinc/kafka-javascript/lib/kafkajs/_consumer.js:1)';

const topicAuthorizationMessage =
  'Consumer encountered error while consuming. Retrying. Error details: KafkaJSProtocolError: Broker: Topic authorization failed : Error: Broker: Topic authorization failed\n    at KafkaConsumer._consumeSingle (node_modules/@confluentinc/kafka-javascript/lib/kafkajs/_consumer.js:1)';

const stillPending = Symbol('still pending');

const settledValue = (failure: Promise<string>) =>
  Promise.race([failure, Promise.resolve(stillPending)]);

describe('JoinFailureDetector forwarding', () => {
  it('forwards info to the inner logger', () => {
    const inner = innerLogger();
    const detector = new JoinFailureDetector(inner);

    detector.info('hello', { a: 1 });

    expect(inner.info).toHaveBeenCalledWith('hello', { a: 1 });
  });

  it('forwards error to the inner logger', () => {
    const inner = innerLogger();
    const detector = new JoinFailureDetector(inner);

    detector.error('boom', { a: 1 });

    expect(inner.error).toHaveBeenCalledWith('boom', { a: 1 });
  });

  it('forwards warn to the inner logger', () => {
    const inner = innerLogger();
    const detector = new JoinFailureDetector(inner);

    detector.warn('careful', { a: 1 });

    expect(inner.warn).toHaveBeenCalledWith('careful', { a: 1 });
  });

  it('forwards debug to the inner logger', () => {
    const inner = innerLogger();
    const detector = new JoinFailureDetector(inner);

    detector.debug('detail', { a: 1 });

    expect(inner.debug).toHaveBeenCalledWith('detail', { a: 1 });
  });

  it('forwards setLogLevel to the inner logger', () => {
    const inner = innerLogger();
    const detector = new JoinFailureDetector(inner);

    detector.setLogLevel(KafkaJS.logLevel.DEBUG);

    expect(inner.setLogLevel).toHaveBeenCalledWith(KafkaJS.logLevel.DEBUG);
  });

  it('forwards an authorization failure to the inner logger', () => {
    const inner = innerLogger();
    const detector = new JoinFailureDetector(inner);

    detector.error(groupAuthorizationMessage, { a: 1 });

    expect(inner.error).toHaveBeenCalledWith(groupAuthorizationMessage, { a: 1 });
  });

  it('returns itself from namespace', () => {
    const detector = new JoinFailureDetector(innerLogger());

    expect(detector.namespace('consumer')).toBe(detector);
  });
});

describe('JoinFailureDetector.failure', () => {
  it('resolves with the group authorization phrase', async () => {
    const detector = new JoinFailureDetector(innerLogger());

    detector.error(groupAuthorizationMessage);

    await expect(detector.failure).resolves.toBe('Broker: Group authorization failed');
  });

  it('resolves with the topic authorization phrase', async () => {
    const detector = new JoinFailureDetector(innerLogger());

    detector.error(topicAuthorizationMessage);

    await expect(detector.failure).resolves.toBe('Broker: Topic authorization failed');
  });

  it('keeps the first failure', async () => {
    const detector = new JoinFailureDetector(innerLogger());

    detector.error(groupAuthorizationMessage);
    detector.error(topicAuthorizationMessage);

    await expect(detector.failure).resolves.toBe('Broker: Group authorization failed');
  });

  it('ignores a connection refused error line', async () => {
    const detector = new JoinFailureDetector(innerLogger());

    detector.error(
      '[thrd:localhost:9092/bootstrap]: localhost:9092/bootstrap: Connect to ipv4#127.0.0.1:9092 failed: Connection refused',
    );

    await expect(settledValue(detector.failure)).resolves.toBe(stillPending);
  });

  it('ignores an all brokers down error line', async () => {
    const detector = new JoinFailureDetector(innerLogger());

    detector.error('Error: all broker connections are down');

    await expect(settledValue(detector.failure)).resolves.toBe(stillPending);
  });

  it('ignores a cluster authorization failure', async () => {
    const detector = new JoinFailureDetector(innerLogger());

    detector.error('KafkaJSProtocolError: Broker: Cluster authorization failed');

    await expect(settledValue(detector.failure)).resolves.toBe(stillPending);
  });

  it('ignores authorization text logged at warn', async () => {
    const detector = new JoinFailureDetector(innerLogger());

    detector.warn(groupAuthorizationMessage);

    await expect(settledValue(detector.failure)).resolves.toBe(stillPending);
  });

  it('ignores authorization text logged at info', async () => {
    const detector = new JoinFailureDetector(innerLogger());

    detector.info(groupAuthorizationMessage);

    await expect(settledValue(detector.failure)).resolves.toBe(stillPending);
  });
});
