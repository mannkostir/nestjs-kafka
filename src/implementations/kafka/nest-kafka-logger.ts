import { KafkaJS } from '@confluentinc/kafka-javascript';
import { Logger } from '@nestjs/common';

export class NestKafkaLogger implements KafkaJS.Logger {
  private level: KafkaJS.logLevel = KafkaJS.logLevel.INFO;

  constructor(private readonly nestLogger: Logger = new Logger('KafkaClient')) {}

  info(message: string, extra?: object): void {
    if (this.allows(KafkaJS.logLevel.INFO)) {
      this.nestLogger.log(NestKafkaLogger.withExtra(message, extra));
    }
  }

  error(message: string, extra?: object): void {
    if (this.allows(KafkaJS.logLevel.ERROR)) {
      this.nestLogger.error(NestKafkaLogger.withExtra(message, extra));
    }
  }

  warn(message: string, extra?: object): void {
    if (this.allows(KafkaJS.logLevel.WARN)) {
      this.nestLogger.warn(NestKafkaLogger.withExtra(message, extra));
    }
  }

  debug(message: string, extra?: object): void {
    if (this.allows(KafkaJS.logLevel.DEBUG)) {
      this.nestLogger.debug(NestKafkaLogger.withExtra(message, extra));
    }
  }

  namespace(_namespace: string): KafkaJS.Logger {
    return this;
  }

  setLogLevel(logLevel: KafkaJS.logLevel): void {
    this.level = logLevel;
  }

  private allows(logLevel: KafkaJS.logLevel): boolean {
    return this.level >= logLevel;
  }

  private static withExtra(message: string, extra?: object): string {
    return extra === undefined ? message : `${message} ${JSON.stringify(extra)}`;
  }
}
