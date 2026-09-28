import type { KafkaJS } from "@confluentinc/kafka-javascript";
import { KafkaErrorHandleStrategy } from "./kafka-error-handle.strategy.js";
import type { RedeliveryBackoff } from "./redelivery-backoff.js";

export class KafkaErrorHandleFailStrategy extends KafkaErrorHandleStrategy {
    constructor(private readonly redelivery?: RedeliveryBackoff) {
        super();
    }

    public async handle(error: unknown, payload: KafkaJS.EachBatchPayload, message: KafkaJS.KafkaMessage): Promise<void> {
        this.redelivery?.postpone(payload, message);
        throw error;
    }

    public override stop(): void {
        this.redelivery?.stop();
    }
}