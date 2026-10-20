export type MessageKey = string | Record<string, unknown> | null;

export type MessageHeaders = Record<string, string | string[]>;

export type KafkaMessage<TValue = unknown> = {
  key: MessageKey;
  value: TValue | null;
  headers?: MessageHeaders;
};
