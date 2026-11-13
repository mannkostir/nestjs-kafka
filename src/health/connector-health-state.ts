import { ConnectorHealthSnapshot, GroupHealth, HealthPartition, WorkerError } from '../types/connector-health.type.js';

export interface GroupObservation {
  assigned(assignment: readonly HealthPartition[]): void;
  assignmentObserved(assignment: readonly HealthPartition[]): void;
  isJoined(): boolean;
  revoked(): void;
  workerFailed(error: unknown): void;
  stopped(): void;
}

type GroupState = {
  groupId: string;
  active: boolean;
  joined: boolean;
  assignment: readonly HealthPartition[];
  lastWorkerError: WorkerError | null;
};

const copyAssignment = (assignment: readonly HealthPartition[]) =>
  Object.freeze(assignment.map(({ topic, partition }) => Object.freeze({ topic, partition })));

const errorMessage = (error: unknown): string => {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return 'Unknown worker error';
  }
};

export class ConnectorHealthState {
  public producerConnected = false;
  private readonly groups = new Map<string, GroupState>();

  startGroup(groupId: string): GroupObservation {
    const state: GroupState = { groupId, active: true, joined: false, assignment: [], lastWorkerError: null };
    this.groups.set(groupId, state);
    const current = () => state.active && this.groups.get(groupId) === state;
    const revoke = () => {
      state.joined = false;
      state.assignment = [];
    };

    return {
      assigned: (assignment) => {
        if (current()) {
          state.joined = true;
          state.assignment = copyAssignment(assignment);
        }
      },
      assignmentObserved: (assignment) => {
        if (current() && state.joined) {
          state.assignment = copyAssignment(assignment);
        }
      },
      isJoined: () => current() && state.joined,
      revoked: () => {
        if (current()) {
          revoke();
        }
      },
      workerFailed: (error) => {
        if (current()) {
          state.lastWorkerError = Object.freeze({ message: errorMessage(error) });
        }
      },
      stopped: () => {
        if (current()) {
          revoke();
          state.active = false;
        }
      },
    };
  }

  stopGroups(): void {
    for (const state of this.groups.values()) {
      state.active = false;
      state.joined = false;
      state.assignment = [];
    }
  }

  snapshot(): ConnectorHealthSnapshot {
    const groups: readonly GroupHealth[] = Object.freeze([...this.groups.values()].map((state) => Object.freeze({
      groupId: state.groupId,
      joined: state.joined,
      assignment: copyAssignment(state.assignment),
      lastWorkerError: state.lastWorkerError,
    })));
    return Object.freeze({ producerConnected: this.producerConnected, groups });
  }
}
