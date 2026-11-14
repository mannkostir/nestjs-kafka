import { ConnectorHealthSnapshot } from '../types/connector-health.type.js';

export abstract class ConnectorHealth {
  abstract snapshot(): ConnectorHealthSnapshot;
}
