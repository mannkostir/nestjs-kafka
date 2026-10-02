export type MessageKey = string | Record<string, unknown> | null;

export type MessageHeaders = Record<string, string | string[]>;

export type MessageType<TValue = unknown> = {
  key: MessageKey;
  value: TValue | null;
  headers?: MessageHeaders;
};
