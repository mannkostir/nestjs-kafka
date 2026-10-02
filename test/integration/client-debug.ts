import { appendFileSync } from 'node:fs';
import { basename } from 'node:path';
import { KafkaJS } from '@confluentinc/kafka-javascript';

type LogSink = (line: string) => void;

type Level = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

export const fileSink =
  (path: string): LogSink =>
  (line) =>
    appendFileSync(path, line);

export const stdoutSink: LogSink = (line) => {
  process.stdout.write(line);
};

const currentTestFile = (): string => {
  const testPath = expect.getState().testPath;
  return testPath === undefined ? 'unknown' : basename(testPath);
};

export class DebugTeeLogger implements KafkaJS.Logger {
  constructor(
    private readonly sink: LogSink,
    private readonly clientId: string,
    private readonly inner?: KafkaJS.Logger,
  ) {}

  info(message: string, extra?: object): void {
    this.record('INFO', message, extra);
    this.inner?.info(message, extra);
  }

  error(message: string, extra?: object): void {
    this.record('ERROR', message, extra);
    this.inner?.error(message, extra);
  }

  warn(message: string, extra?: object): void {
    this.record('WARN', message, extra);
    this.inner?.warn(message, extra);
  }

  debug(message: string, extra?: object): void {
    this.record('DEBUG', message, extra);
  }

  namespace(_namespace: string): KafkaJS.Logger {
    return this;
  }

  setLogLevel(_logLevel: KafkaJS.logLevel): void {}

  private record(level: Level, message: string, extra?: object): void {
    const fields = [
      new Date().toISOString(),
      currentTestFile(),
      this.clientId,
      level,
      message,
      extra === undefined ? '' : JSON.stringify(extra),
    ];
    this.sink(`${fields.join(' | ')}\n`);
  }
}

export const debuggingKafka = (contexts: string, sink: LogSink): typeof KafkaJS.Kafka => {
  const teeing = <C extends { kafkaJS?: { logger?: KafkaJS.Logger } }>(clientId: string, config: C): C =>
    config.kafkaJS === undefined
      ? config
      : {
          ...config,
          kafkaJS: {
            ...config.kafkaJS,
            logger: new DebugTeeLogger(sink, clientId, config.kafkaJS.logger),
          },
        };

  return class DebuggingKafka extends KafkaJS.Kafka {
    private readonly clientId: string;

    constructor(config: KafkaJS.CommonConstructorConfig = {}) {
      const clientId = config.kafkaJS?.clientId ?? 'unnamed';
      super({ ...teeing(clientId, config), debug: contexts });
      this.clientId = clientId;
    }

    override producer(config: KafkaJS.ProducerConstructorConfig = {}): KafkaJS.Producer {
      return super.producer(teeing(`${this.clientId}/producer`, config));
    }

    override consumer(config: KafkaJS.ConsumerConstructorConfig): KafkaJS.Consumer {
      return super.consumer(teeing(`${this.clientId}/consumer:${config.kafkaJS?.groupId ?? 'no-group'}`, config));
    }

    override admin(config: KafkaJS.AdminConstructorConfig = {}): KafkaJS.Admin {
      return super.admin(teeing(`${this.clientId}/admin`, config));
    }
  };
};
