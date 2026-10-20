import { LibrdkafkaTopicPattern } from './librdkafka-topic-pattern.js';

type NamedRoute = { handlerName: string };

export type RouteClaim<TRoute extends NamedRoute> = {
  topics: readonly (string | RegExp)[];
  route: TRoute;
};

export type RouteResolution<TRoute> =
  | { kind: 'owned'; route: TRoute }
  | { kind: 'unroutable'; reason: string };

type PatternClaim<TRoute> = { matcher: RegExp; route: TRoute };

export class KafkaHandlerRoutes<TRoute extends NamedRoute> {
  private readonly resolved = new Map<string, RouteResolution<TRoute>>();

  private constructor(
    private readonly groupId: string,
    private readonly owners: ReadonlyMap<string, TRoute>,
    private readonly patterns: readonly PatternClaim<TRoute>[],
  ) {}

  static claim<TRoute extends NamedRoute>(
    groupId: string,
    claims: readonly RouteClaim<TRoute>[],
  ): KafkaHandlerRoutes<TRoute> {
    const owners = new Map<string, TRoute>();
    const patterns: PatternClaim<TRoute>[] = [];

    for (const { topics, route } of claims) {
      for (const topic of topics) {
        if (topic instanceof RegExp) {
          patterns.push({ matcher: LibrdkafkaTopicPattern.matcher(topic), route });
        } else {
          KafkaHandlerRoutes.assertUnclaimed(groupId, owners.get(topic), route, topic);
          owners.set(topic, route);
        }
      }
    }

    return new KafkaHandlerRoutes(groupId, owners, patterns);
  }

  resolve(topic: string): RouteResolution<TRoute> {
    const cached = this.resolved.get(topic);

    if (cached) {
      return cached;
    }

    const resolution = this.resolveUncached(topic);
    this.resolved.set(topic, resolution);
    return resolution;
  }

  private resolveUncached(topic: string): RouteResolution<TRoute> {
    const owner = this.owners.get(topic);

    if (owner) {
      return { kind: 'owned', route: owner };
    }

    const matching = [...new Set(this.patterns.filter(({ matcher }) => matcher.test(topic)).map(({ route }) => route))];

    if (matching.length === 1) {
      return { kind: 'owned', route: matching[0] };
    }

    return { kind: 'unroutable', reason: this.unroutableReason(topic, matching) };
  }

  private unroutableReason(topic: string, matching: readonly TRoute[]): string {
    if (matching.length === 0) {
      return `Topic "${topic}" matches no handler of shared group "${this.groupId}".`;
    }

    const names = matching.map(({ handlerName }) => handlerName);
    const listed = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

    return (
      `Topic "${topic}" matches the patterns of message handlers ${listed} in shared group "${this.groupId}". ` +
      'Each topic in a shared group must belong to exactly one handler: rename the topic, narrow the patterns, ' +
      'or list the topic by name on the handler that should consume it.'
    );
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
