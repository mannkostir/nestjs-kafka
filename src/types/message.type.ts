export type MessageKey =
  | string
  | {
      [key: string]: any;
    } | null;

export type MessageType<TValue = unknown> = {
  key: MessageKey | null;
  value: TValue | null;
  headers?: Record<string, any>;
};
