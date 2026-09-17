const FLOW_STATUSES = ["active", "paused", "draft"] as const;

export type FlowStatus = (typeof FLOW_STATUSES)[number];

export function groupFlowsByStatus<T extends { status: FlowStatus }>(flows: readonly T[]) {
  return FLOW_STATUSES.map((status) => ({
    status,
    flows: flows.filter((flow) => flow.status === status),
  })).filter((group) => group.flows.length > 0);
}
