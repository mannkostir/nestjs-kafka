import { validateKafkaModuleOptions } from './kafka-module-options.validation.js';
import { KafkaModuleOptions } from './types/kafka-module-options.type.js';
import { MessageFormat } from './types/message-format.type.js';

const clientOptions = { kafkaJS: { brokers: ['localhost:9092'] } };

const validating = (options: unknown) => () => validateKafkaModuleOptions(options);

describe('validateKafkaModuleOptions', () => {
  it('returns valid options unchanged', () => {
    const options: KafkaModuleOptions = {
      clientOptions,
      namespace: 'staging',
      connectorName: 'analytics',
      schemaRegistry: { url: 'http://localhost:8081' },
      consumerDefaults: { fromBeginning: true },
      producer: { allowAutoTopicCreation: true },
      messageFormat: MessageFormat.AVRO,
    };

    expect(validateKafkaModuleOptions(options)).toBe(options);
  });

  it('accepts options with only clientOptions', () => {
    const options = { clientOptions };

    expect(validateKafkaModuleOptions(options)).toBe(options);
  });

  it('rejects undefined options and says how to supply them', () => {
    expect(validating(undefined)).toThrow(
      'KafkaModule options must be an object, got undefined. Pass an options object with clientOptions to KafkaModule.register, or return one from useFactory or createKafkaOptions.',
    );
  });

  it('rejects options that are not an object', () => {
    expect(validating('localhost:9092')).toThrow(
      'KafkaModule options must be an object, got string.',
    );
  });

  it('rejects null options', () => {
    expect(validating(null)).toThrow(
      'KafkaModule options must be an object, got null.',
    );
  });

  it('rejects missing clientOptions and says how to set them', () => {
    expect(validating({})).toThrow(
      '- "clientOptions" must be an object. Set clientOptions to the client configuration, for example { kafkaJS: { brokers: [\'localhost:9092\'] } }.',
    );
  });

  it('rejects null clientOptions', () => {
    expect(validating({ clientOptions: null })).toThrow(
      '- "clientOptions" must be an object.',
    );
  });

  it('rejects an empty namespace and says how to fix it', () => {
    expect(validating({ clientOptions, namespace: '' })).toThrow(
      '- "namespace" must not be an empty string. Set a non-empty namespace, or leave it undefined to disable namespacing.',
    );
  });

  it('rejects a namespace that is not a string', () => {
    expect(validating({ clientOptions, namespace: 42 })).toThrow(
      '- "namespace" must be a string, got number. Set a non-empty namespace, or leave it undefined to disable namespacing.',
    );
  });

  it('rejects an empty connector name and says how to fix it', () => {
    expect(validating({ clientOptions, connectorName: '' })).toThrow(
      '- "connectorName" must not be an empty string. Set a non-empty connectorName matching @Message({ connectorName }), or leave it undefined for the unnamed connector.',
    );
  });

  it('rejects a connector name that is not a string', () => {
    expect(validating({ clientOptions, connectorName: true })).toThrow(
      '- "connectorName" must be a string, got boolean.',
    );
  });

  it('rejects a schema registry that is not an object', () => {
    expect(validating({ clientOptions, schemaRegistry: 'http://localhost:8081' })).toThrow(
      '- "schemaRegistry" must be an object with a non-empty "url". Set schemaRegistry to { url: \'http://localhost:8081\' }, or leave it undefined if you do not use Avro.',
    );
  });

  it('rejects a schema registry without a url', () => {
    expect(validating({ clientOptions, schemaRegistry: {} })).toThrow(
      '- "schemaRegistry" must be an object with a non-empty "url".',
    );
  });

  it('rejects a schema registry with an empty url', () => {
    expect(validating({ clientOptions, schemaRegistry: { url: '' } })).toThrow(
      '- "schemaRegistry" must be an object with a non-empty "url".',
    );
  });

  it('rejects consumer defaults that are not an object', () => {
    expect(validating({ clientOptions, consumerDefaults: 'earliest' })).toThrow(
      '- "consumerDefaults" must be an object. Set consumerDefaults to a ConsumerOptions object, or leave it undefined.',
    );
  });

  it('rejects producer settings that are not an object', () => {
    expect(validating({ clientOptions, producer: true })).toThrow(
      '- "producer" must be an object. Set producer to a ProducerOptions object, or leave it undefined.',
    );
  });

  it('rejects an unknown message format and says how to fix it', () => {
    expect(validating({ clientOptions, messageFormat: 'Json' })).toThrow(
      '- "messageFormat" must be one of json, enveloped-json, avro. Use a MessageFormat value, or leave it undefined for json.',
    );
  });

  it('rejects a negative shutdown timeout and says how to fix it', () => {
    expect(validating({ clientOptions, shutdownTimeout: -1 })).toThrow(
      '- "shutdownTimeout" must be a non-negative finite number of milliseconds, got -1. Set shutdownTimeout to how long shutdown waits for consumers to disconnect, or leave it undefined for 10000.',
    );
  });

  it('rejects a shutdown timeout that is not a number', () => {
    expect(validating({ clientOptions, shutdownTimeout: '5000' })).toThrow(
      '- "shutdownTimeout" must be a non-negative finite number of milliseconds, got string.',
    );
  });

  it('rejects a NaN shutdown timeout', () => {
    expect(validating({ clientOptions, shutdownTimeout: NaN })).toThrow(
      '- "shutdownTimeout" must be a non-negative finite number of milliseconds, got NaN.',
    );
  });

  it('rejects an infinite shutdown timeout', () => {
    expect(validating({ clientOptions, shutdownTimeout: Infinity })).toThrow(
      '- "shutdownTimeout" must be a non-negative finite number of milliseconds, got Infinity.',
    );
  });

  it('accepts a zero shutdown timeout', () => {
    const options = { clientOptions, shutdownTimeout: 0 };

    expect(validateKafkaModuleOptions(options)).toBe(options);
  });

  it('accepts an omitted shutdown timeout', () => {
    const options = { clientOptions, shutdownTimeout: undefined };

    expect(validateKafkaModuleOptions(options)).toBe(options);
  });

  it('reports every problem in one error', () => {
    expect(validating({ namespace: '', messageFormat: 'Json' })).toThrow(
      [
        'Invalid KafkaModule options:',
        '- "clientOptions" must be an object. Set clientOptions to the client configuration, for example { kafkaJS: { brokers: [\'localhost:9092\'] } }.',
        '- "namespace" must not be an empty string. Set a non-empty namespace, or leave it undefined to disable namespacing.',
        '- "messageFormat" must be one of json, enveloped-json, avro. Use a MessageFormat value, or leave it undefined for json.',
      ].join('\n'),
    );
  });
});
