import { KafkaModuleOptions } from './types/kafka-module-options.type.js';
import { MessageFormat } from './types/message-format.type.js';

type OptionsCheck = (options: Record<string, unknown>) => string | undefined;

const messageFormats: readonly unknown[] = Object.values(MessageFormat);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const kindOf = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

const optionalNonEmptyString =
  (option: keyof KafkaModuleOptions, fix: string): OptionsCheck =>
  (options) => {
    const value = options[option];
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'string') {
      return `"${option}" must be a string, got ${kindOf(value)}. ${fix}`;
    }
    if (value === '') {
      return `"${option}" must not be an empty string. ${fix}`;
    }
    return undefined;
  };

const optionalObject =
  (option: keyof KafkaModuleOptions, fix: string): OptionsCheck =>
  (options) => {
    const value = options[option];
    if (value === undefined || isObject(value)) {
      return undefined;
    }
    return `"${option}" must be an object. ${fix}`;
  };

const clientOptionsCheck: OptionsCheck = (options) =>
  isObject(options.clientOptions)
    ? undefined
    : `"clientOptions" must be an object. Set clientOptions to the client configuration, for example { kafkaJS: { brokers: ['localhost:9092'] } }.`;

const hasSchemaRegistryUrl = (schemaRegistry: unknown): boolean =>
  isObject(schemaRegistry) &&
  typeof schemaRegistry.url === 'string' &&
  schemaRegistry.url.length > 0;

const schemaRegistryCheck: OptionsCheck = (options) =>
  options.schemaRegistry === undefined ||
  hasSchemaRegistryUrl(options.schemaRegistry)
    ? undefined
    : `"schemaRegistry" must be an object with a non-empty "url". Set schemaRegistry to { url: 'http://localhost:8081' }, or leave it undefined if you do not use Avro.`;

const messageFormatCheck: OptionsCheck = (options) =>
  options.messageFormat === undefined ||
  messageFormats.includes(options.messageFormat)
    ? undefined
    : `"messageFormat" must be one of ${messageFormats.join(', ')}. Use a MessageFormat value, or leave it undefined for ${MessageFormat.JSON}.`;

const optionsChecks: readonly OptionsCheck[] = [
  clientOptionsCheck,
  optionalNonEmptyString(
    'namespace',
    'Set a non-empty namespace, or leave it undefined to disable namespacing.',
  ),
  optionalNonEmptyString(
    'connectorName',
    'Set a non-empty connectorName matching @Message({ connectorName }), or leave it undefined for the unnamed connector.',
  ),
  schemaRegistryCheck,
  optionalObject(
    'consumerDefaults',
    'Set consumerDefaults to a ConsumerConfig object, or leave it undefined.',
  ),
  optionalObject(
    'producer',
    'Set producer to a ProducerConfig object, or leave it undefined.',
  ),
  messageFormatCheck,
];

export function validateKafkaModuleOptions(
  options: unknown,
): KafkaModuleOptions {
  if (!isObject(options)) {
    throw new Error(
      `KafkaModule options must be an object, got ${kindOf(options)}. Pass an options object with clientOptions to KafkaModule.register, or return one from useFactory or createKafkaOptions.`,
    );
  }
  const problems = optionsChecks
    .map((check) => check(options))
    .filter((problem): problem is string => problem !== undefined);
  if (problems.length > 0) {
    throw new Error(
      ['Invalid KafkaModule options:', ...problems.map((problem) => `- ${problem}`)].join('\n'),
    );
  }
  return options as KafkaModuleOptions;
}
