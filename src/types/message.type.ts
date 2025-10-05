export type MessageKey =
  | string
  | {
      [key: string]: any;
    } | null;

export type MessageValue<Payload extends Record<string, any> = Record<string, any>> = {
    payload: Payload | null;
};

export type MessageType<
  Payload extends Record<string, any> = Record<string, any>,
> = {
  key: MessageKey | null;
  value: MessageValue<Payload> | null;
  headers?: Record<string, any>;
};
