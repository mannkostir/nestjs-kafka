export class SubscriptionAborted extends Error {
  public override readonly name = 'SubscriptionAborted';

  constructor(groupId: string) {
    super(`Consumer group "${groupId}" stopped subscribing because the connector released its connections.`);
  }
}
