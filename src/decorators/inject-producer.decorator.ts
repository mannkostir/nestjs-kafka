import { Inject } from '@nestjs/common';
import { getProducerToken } from '../tokens.js';

export function InjectProducer(connectorName: string): ReturnType<typeof Inject> {
  return Inject(getProducerToken(connectorName));
}
