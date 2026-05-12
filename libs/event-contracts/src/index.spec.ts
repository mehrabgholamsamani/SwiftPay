import { messageEnvelope, type MessageEnvelope } from './index';

describe('message envelope', () => {
  it('requires causation and correlation metadata fields by contract', () => {
    const event: MessageEnvelope<{ paymentId: string }> = {
      messageId: 'm1',
      messageType: 'payment.created.v1',
      messageVersion: 1,
      aggregateId: 'p1',
      correlationId: 'c1',
      causationId: 'command-1',
      producer: 'payment-service',
      occurredAt: new Date().toISOString(),
      payload: { paymentId: 'p1' },
    };
    expect(event.messageType).toBe('payment.created.v1');
  });

  it('keeps message metadata separate from the payload', () => {
    const message = messageEnvelope(
      {
        messageId: 'm1',
        messageType: 'example.completed.v1',
        messageVersion: 1,
        aggregateId: 'a1',
        correlationId: 'c1',
        producer: 'example-service',
        occurredAt: '2026-01-01T00:00:00.000Z',
      },
      { result: 'ok' },
    );
    expect(message).toMatchObject({ payload: { result: 'ok' }, correlationId: 'c1' });
  });
});
