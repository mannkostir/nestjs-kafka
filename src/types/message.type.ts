export type MessageKey =
  | string
  | {
      [key: string]: any;
    } | null;

export type MessageHeaders = Record<string, string | string[]>;

export type MessageType<TValue = unknown> = {
  key: MessageKey | null;
  value: TValue | null;
  headers?: MessageHeaders;
};
