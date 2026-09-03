export function presenceKeyFor(agentId: string): string {
  return `presence:agent:${agentId}`;
}
