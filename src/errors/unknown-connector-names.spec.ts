import { UnknownConnectorNames } from './unknown-connector-names.js';

describe('UnknownConnectorNames', () => {
  it('is named UnknownConnectorNames', () => {
    expect(new UnknownConnectorNames([], []).name).toBe('UnknownConnectorNames');
  });

  it('is an error', () => {
    expect(new UnknownConnectorNames([], [])).toBeInstanceOf(Error);
  });

  it('names every unknown connector name with its handlers, the registered names and the fix', () => {
    const error = new UnknownConnectorNames(
      [
        {
          connectorName: 'analytcs',
          handlerNames: ['ClicksHandler.onClick', 'ViewsHandler.onView'],
        },
        { connectorName: 'billing', handlerNames: ['InvoicesHandler.onInvoice'] },
      ],
      ['analytics', 'payments'],
    );

    expect(error.message).toBe(
      'Message handlers name connectorNames that no KafkaModule registers:\n' +
        '- "analytcs": ClicksHandler.onClick, ViewsHandler.onView\n' +
        '- "billing": InvoicesHandler.onInvoice\n' +
        'Registered connectorNames: "analytics", "payments".\n' +
        "Set each handler's connectorName to a registered one, or register a KafkaModule with that connectorName.",
    );
  });

  it('labels an unknown unnamed connector as the unnamed connector', () => {
    const error = new UnknownConnectorNames(
      [{ connectorName: undefined, handlerNames: ['OrdersHandler.onOrder'] }],
      ['analytics'],
    );

    expect(error.message).toContain('- the unnamed connector: OrdersHandler.onOrder\n');
  });

  it('labels a registered unnamed connector as the unnamed connector', () => {
    const error = new UnknownConnectorNames(
      [{ connectorName: 'analytcs', handlerNames: ['ClicksHandler.onClick'] }],
      [undefined, 'analytics'],
    );

    expect(error.message).toContain(
      'Registered connectorNames: the unnamed connector, "analytics".\n',
    );
  });

  it('says so when no connector is registered', () => {
    const error = new UnknownConnectorNames(
      [{ connectorName: 'analytcs', handlerNames: ['ClicksHandler.onClick'] }],
      [],
    );

    expect(error.message).toContain('Registered connectorNames: none.\n');
  });

  it('carries the unknown connector names with their handlers', () => {
    const unknown = [
      { connectorName: 'analytcs', handlerNames: ['ClicksHandler.onClick'] },
    ];

    expect(new UnknownConnectorNames(unknown, []).unknown).toEqual(unknown);
  });

  it('carries the registered connector names', () => {
    expect(
      new UnknownConnectorNames([], [undefined, 'analytics']).registered,
    ).toEqual([undefined, 'analytics']);
  });
});
