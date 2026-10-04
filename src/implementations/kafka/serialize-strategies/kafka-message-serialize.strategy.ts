export abstract class KafkaMessageSerializeStrategy {
  public abstract serialize(value: unknown): Promise<string | Buffer | null>;
}
