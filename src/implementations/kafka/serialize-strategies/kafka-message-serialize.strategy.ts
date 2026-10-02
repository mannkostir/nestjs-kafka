export abstract class KafkaMessageSerializeStrategy {
  public abstract serialize(value: unknown): string | null;
}
