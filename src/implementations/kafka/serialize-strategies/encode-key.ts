import { MessageKey } from '../../../types/message.type.js';

export function encodeKey(key: MessageKey): string | null {
  if (key === null || typeof key === 'string') {
    return key;
  }

  return JSON.stringify(key);
}
