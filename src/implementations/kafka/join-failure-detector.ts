import type { KafkaJS } from '@confluentinc/kafka-javascript';

const AUTHORIZATION_FAILURE = /Broker: (?:Group|Topic) authorization failed/;

export class JoinFailureDetector implements KafkaJS.Logger {
  private recordFailure: (reason: string) => void = () => undefined;

  public readonly failure = new Promise<string>((resolve) => {
    this.recordFailure = resolve;
  });

  constructor(private readonly inner: KafkaJS.Logger) {}

  info(message: string, extra?: object): void {
    this.inner.info(message, extra);
  }

  error(message: string, extra?: object): void {
    this.detect(message);
    this.inner.error(message, extra);
  }

  warn(message: string, extra?: object): void {
    this.inner.warn(message, extra);
  }

  debug(message: string, extra?: object): void {
    this.inner.debug(message, extra);
  }

  namespace(_namespace: string): KafkaJS.Logger {
    return this;
  }

  setLogLevel(logLevel: KafkaJS.logLevel): void {
    this.inner.setLogLevel(logLevel);
  }

  private detect(message: string): void {
    const match = AUTHORIZATION_FAILURE.exec(message);
    if (match) {
      this.recordFailure(match[0]);
    }
  }
}
