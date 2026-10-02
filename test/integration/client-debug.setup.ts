import { KafkaJS } from '@confluentinc/kafka-javascript';
import { debuggingKafka, fileSink, stdoutSink } from './client-debug.js';

const contexts = process.env.KAFKA_CLIENT_DEBUG;
const logPath = process.env.KAFKA_CLIENT_DEBUG_LOG;

if (contexts) {
  Object.defineProperty(KafkaJS, 'Kafka', {
    value: debuggingKafka(contexts, logPath ? fileSink(logPath) : stdoutSink),
  });
}
