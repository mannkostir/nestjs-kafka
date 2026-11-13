import { ConnectorHealthState } from './connector-health-state.js';

describe('connector health state', () => {
  it('starts disconnected with no groups', () => {
    expect(new ConnectorHealthState().snapshot()).toEqual({ producerConnected: false, groups: [] });
  });

  it('records an empty assignment as joined', () => {
    const state = new ConnectorHealthState();
    state.startGroup('g').assigned([]);

    expect(state.snapshot().groups[0]).toEqual({ groupId: 'g', joined: true, assignment: [], lastWorkerError: null });
  });

  it('clears assignment on revocation', () => {
    const state = new ConnectorHealthState();
    const group = state.startGroup('g');
    group.assigned([{ topic: 'orders', partition: 0 }]);
    group.revoked();

    expect(state.snapshot().groups[0]).toMatchObject({ joined: false, assignment: [] });
  });

  it('ignores callbacks from a replaced subscription', () => {
    const state = new ConnectorHealthState();
    const old = state.startGroup('g');
    const current = state.startGroup('g');
    current.assigned([{ topic: 'orders', partition: 1 }]);
    old.assigned([{ topic: 'stale', partition: 0 }]);
    old.workerFailed(new Error('old worker'));
    old.stopped();

    expect(state.snapshot().groups[0]).toEqual({ groupId: 'g', joined: true, assignment: [{ topic: 'orders', partition: 1 }], lastWorkerError: null });
  });

  it('ignores late callbacks after stopping a pending start', () => {
    const state = new ConnectorHealthState();
    const group = state.startGroup('g');
    state.stopGroups();
    group.assigned([{ topic: 'late', partition: 0 }]);

    expect(state.snapshot().groups[0].joined).toBe(false);
  });

  it('copies assignment input before retaining it', () => {
    const state = new ConnectorHealthState();
    const assignment = [{ topic: 'orders', partition: 0 }];
    state.startGroup('g').assigned(assignment);
    assignment[0].partition = 9;
    assignment.push({ topic: 'other', partition: 1 });

    expect(state.snapshot().groups[0].assignment).toEqual([{ topic: 'orders', partition: 0 }]);
  });

  it('returns frozen snapshots detached from later observations', () => {
    const state = new ConnectorHealthState();
    const group = state.startGroup('g');
    group.assigned([{ topic: 'orders', partition: 0 }]);
    group.workerFailed(new Error('worker failed'));
    const snapshot = state.snapshot();
    group.revoked();

    expect([snapshot, snapshot.groups, snapshot.groups[0], snapshot.groups[0].assignment, snapshot.groups[0].assignment[0], snapshot.groups[0].lastWorkerError].every(Object.isFrozen)).toBe(true);
    expect(snapshot.groups[0].joined).toBe(true);
  });
});
