import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { RetryHeaders } from './retry-headers.js';

const withHeaders = (headers?: KafkaJS.IHeaders): KafkaJS.KafkaMessage => ({
  key: null, value: null, timestamp: '0', size: 0, attributes: 0, offset: '0', headers: headers as KafkaJS.IHeaders | undefined,
}) as KafkaJS.KafkaMessage;

describe('RetryHeaders', () => {
  const hop = { originalTopic: 'orders.created', attempt: 2, dueAt: 1700000000000, error: new TypeError('boom') };

  it('describes the hop and its failure', () => {
    expect(RetryHeaders.forHop(undefined, hop)).toEqual({
      'retry.original.topic': 'orders.created',
      'retry.attempt': '2',
      'retry.due': '1700000000000',
      'retry.error.name': 'TypeError',
      'retry.error.message': 'boom',
    });
  });

  it('keeps the original headers', () => {
    expect(RetryHeaders.forHop({ trace: 'abc' }, hop)).toEqual(expect.objectContaining({ trace: 'abc' }));
  });

  it('overwrites the headers of a previous hop', () => {
    const previous = RetryHeaders.forHop(undefined, { ...hop, attempt: 1, error: new Error('first') });

    expect(RetryHeaders.forHop(previous, hop)['retry.error.message']).toBe('boom');
  });

  it('records a thrown non-error as its string form', () => {
    expect(RetryHeaders.forHop(undefined, { ...hop, error: 42 })['retry.error.message']).toBe('42');
  });

  it('reads the due time from a buffer header', () => {
    expect(RetryHeaders.dueAt(withHeaders({ 'retry.due': Buffer.from('1700000000000') }))).toBe(1700000000000);
  });

  it('reads the due time from a string header', () => {
    expect(RetryHeaders.dueAt(withHeaders({ 'retry.due': '1700000000000' }))).toBe(1700000000000);
  });

  it('reads the first due time of a repeated header', () => {
    expect(RetryHeaders.dueAt(withHeaders({ 'retry.due': [Buffer.from('5'), Buffer.from('9')] }))).toBe(5);
  });

  it.each([undefined, {}, { 'retry.due': 'soon' }, { 'retry.due': '' }])('has no due time for headers %p', (headers) => {
    expect(RetryHeaders.dueAt(withHeaders(headers))).toBeNaN();
  });
});
