export type ConnectorName = string | undefined;

export type UnknownConnector = {
  readonly connectorName: ConnectorName;
  readonly handlerNames: readonly string[];
};

export class UnknownConnectorNames extends Error {
  public override readonly name = 'UnknownConnectorNames';

  constructor(
    readonly unknown: readonly UnknownConnector[],
    readonly registered: readonly ConnectorName[],
  ) {
    super(UnknownConnectorNames.describe(unknown, registered));
  }

  private static describe(
    unknown: readonly UnknownConnector[],
    registered: readonly ConnectorName[],
  ): string {
    return [
      'Message handlers name connectorNames that no KafkaModule registers:',
      ...unknown.map(
        ({ connectorName, handlerNames }) =>
          `- ${UnknownConnectorNames.label(connectorName)}: ${handlerNames.join(', ')}`,
      ),
      `Registered connectorNames: ${UnknownConnectorNames.registeredList(registered)}.`,
      "Set each handler's connectorName to a registered one, or register a KafkaModule with that connectorName.",
    ].join('\n');
  }

  private static registeredList(registered: readonly ConnectorName[]): string {
    return registered.length > 0
      ? registered.map((connectorName) => UnknownConnectorNames.label(connectorName)).join(', ')
      : 'none';
  }

  private static label(connectorName: ConnectorName): string {
    return connectorName === undefined
      ? 'the unnamed connector'
      : `"${connectorName}"`;
  }
}
