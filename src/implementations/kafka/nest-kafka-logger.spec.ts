import { KafkaJS } from '@confluentinc/kafka-javascript';
import { Logger } from '@nestjs/common';
import { NestKafkaLogger } from './nest-kafka-logger.js';

const silentNestLogger = () => {
  const logger = new Logger('KafkaClientSpec');
  jest.spyOn(logger, 'log').mockImplementation(() => undefined);
  jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn(logger, 'debug').mockImplementation(() => undefined);
  return logger;
};

describe('NestKafkaLogger mapping', () => {
  it('maps info to log', () => {
    const nestLogger = silentNestLogger();
    const logger = new NestKafkaLogger(nestLogger);

    logger.info('hello');

    expect(nestLogger.log).toHaveBeenCalledWith('hello');
  });

  it('maps error to error', () => {
    const nestLogger = silentNestLogger();
    const logger = new NestKafkaLogger(nestLogger);

    logger.error('boom');

    expect(nestLogger.error).toHaveBeenCalledWith('boom');
  });

  it('maps warn to warn', () => {
    const nestLogger = silentNestLogger();
    const logger = new NestKafkaLogger(nestLogger);

    logger.warn('careful');

    expect(nestLogger.warn).toHaveBeenCalledWith('careful');
  });

  it('maps debug to debug once the level allows it', () => {
    const nestLogger = silentNestLogger();
    const logger = new NestKafkaLogger(nestLogger);
    logger.setLogLevel(KafkaJS.logLevel.DEBUG);

    logger.debug('detail');

    expect(nestLogger.debug).toHaveBeenCalledWith('detail');
  });

  it('folds extra into the message when present', () => {
    const nestLogger = silentNestLogger();
    const logger = new NestKafkaLogger(nestLogger);

    logger.error('boom', { broker: 'b1' });

    expect(nestLogger.error).toHaveBeenCalledWith('boom {"broker":"b1"}');
  });

  it('returns itself from namespace', () => {
    const logger = new NestKafkaLogger(silentNestLogger());

    expect(logger.namespace('consumer')).toBe(logger);
  });
});

describe('NestKafkaLogger levels', () => {
  it('suppresses debug at the default level', () => {
    const nestLogger = silentNestLogger();
    const logger = new NestKafkaLogger(nestLogger);

    logger.debug('detail');

    expect(nestLogger.debug).not.toHaveBeenCalled();
  });

  it('suppresses info once the level is error', () => {
    const nestLogger = silentNestLogger();
    const logger = new NestKafkaLogger(nestLogger);
    logger.setLogLevel(KafkaJS.logLevel.ERROR);

    logger.info('hello');

    expect(nestLogger.log).not.toHaveBeenCalled();
  });

  it('suppresses warn once the level is error', () => {
    const nestLogger = silentNestLogger();
    const logger = new NestKafkaLogger(nestLogger);
    logger.setLogLevel(KafkaJS.logLevel.ERROR);

    logger.warn('careful');

    expect(nestLogger.warn).not.toHaveBeenCalled();
  });

  it('suppresses error once the level is nothing', () => {
    const nestLogger = silentNestLogger();
    const logger = new NestKafkaLogger(nestLogger);
    logger.setLogLevel(KafkaJS.logLevel.NOTHING);

    logger.error('boom');

    expect(nestLogger.error).not.toHaveBeenCalled();
  });
});
