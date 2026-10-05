type NamedRoute = { handlerName: string };

export type RouteClaim<TRoute extends NamedRoute> = {
  topics: readonly (string | RegExp)[];
  route: TRoute;
};

export class KafkaHandlerRoutes<TRoute extends NamedRoute> {
  private constructor(
    private readonly groupId: string,
    private readonly owners: ReadonlyMap<string, TRoute>,
  ) {}

  static claim<TRoute extends NamedRoute>(
    groupId: string,
    claims: readonly RouteClaim<TRoute>[],
  ): KafkaHandlerRoutes<TRoute> {
    const owners = new Map<string, TRoute>();

    for (const { topics, route } of claims) {
      for (const topic of topics) {
        KafkaHandlerRoutes.assertConcrete(groupId, route, topic);
        KafkaHandlerRoutes.assertUnclaimed(groupId, owners.get(topic), route, topic);
        owners.set(topic, route);
      }
    }

    return new KafkaHandlerRoutes(groupId, owners);
  }

  handlerFor(topic: string): TRoute {
    const owner = this.owners.get(topic);

    if (!owner) {
      throw new Error(
        `Received a batch from topic "${topic}", which no handler of shared group "${this.groupId}" consumes.`,
      );
    }

    return owner;
  }

  private static assertConcrete(
    groupId: string,
    route: NamedRoute,
    topic: string | RegExp,
  ): asserts topic is string {
    if (topic instanceof RegExp) {
      throw new Error(
        `Message handler ${route.handlerName} subscribes to a RegExp pattern in shared group "${groupId}". Handlers in a shared group must list concrete topic names.`,
      );
    }
  }

  private static assertUnclaimed(
    groupId: string,
    owner: NamedRoute | undefined,
    challenger: NamedRoute,
    topic: string,
  ): void {
    if (owner && owner !== challenger) {
      throw new Error(
        `Message handlers ${owner.handlerName} and ${challenger.handlerName} share group "${groupId}" and both consume topic "${topic}". Each topic in a shared group must belong to exactly one handler.`,
      );
    }
  }
}
