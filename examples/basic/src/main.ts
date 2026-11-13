import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Injectable, Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { KafkaModule, Message, ProducerProxy } from 'nestjs-kafka-connector';
import type { KafkaMessage, MessageContext } from 'nestjs-kafka-connector';

type OrderCreated = { orderId: string; total: number };

@Injectable()
class OrderHandler {
  private readonly logger = new Logger(OrderHandler.name);

  @Message(['orders.created'], {
    groupId: 'basic-example',
    consumer: { fromBeginning: true },
    errorHandling: { type: 'fail' },
  })
  async handle(message: KafkaMessage<OrderCreated>, context: MessageContext): Promise<void> {
    if (message.value) {
      this.logger.log(
        `Received order ${message.value.orderId}: total=${message.value.total}, topic=${context.topic}, partition=${context.partition}, offset=${context.offset}`,
      );
    }
  }
}

@Injectable()
class OrderPublisher {
  private readonly logger = new Logger(OrderPublisher.name);

  constructor(private readonly producer: ProducerProxy) {}

  async publish(): Promise<void> {
    const orderId = randomUUID();
    await this.producer.send('orders.created', {
      key: orderId,
      value: { orderId, total: 42 },
    });
    this.logger.log(`Published order ${orderId}`);
  }
}

@Module({
  imports: [
    KafkaModule.register({
      clientOptions: {
        kafkaJS: { clientId: 'basic-example', brokers: ['localhost:9092'] },
      },
      consumerDefaults: { createMissingTopics: true },
    }),
  ],
  providers: [OrderHandler, OrderPublisher],
})
class AppModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { abortOnError: false });
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);

  try {
    await app.get(OrderPublisher).publish();
  } catch (error) {
    await app.close();
    throw error;
  }
}

bootstrap().catch((error: unknown) => {
  Logger.error(error, undefined, 'Bootstrap');
  process.exitCode = 1;
});
