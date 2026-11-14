export type HealthPartition = Readonly<{ topic: string; partition: number }>;

export type WorkerError = Readonly<{ message: string }>;

export type GroupHealth = Readonly<{
  groupId: string;
  joined: boolean;
  assignment: readonly HealthPartition[];
  lastWorkerError: WorkerError | null;
}>;

export type ConnectorHealthSnapshot = Readonly<{
  producerConnected: boolean;
  groups: readonly GroupHealth[];
}>;
