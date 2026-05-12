import type {
  RuntimeServiceDefinition,
  RuntimeTopologyConfig,
} from "./types.js";

export interface RuntimeTopologyService extends RuntimeServiceDefinition {
  id: string;
}

function visitRuntimeService(
  topology: RuntimeTopologyConfig,
  serviceId: string,
  visiting: Set<string>,
  visited: Set<string>,
  ordered: RuntimeTopologyService[],
): void {
  if (visited.has(serviceId)) return;
  if (visiting.has(serviceId)) {
    const cycle = [...visiting, serviceId].join(" -> ");
    throw new Error(`Runtime topology cycle detected: ${cycle}`);
  }

  const service = topology.services[serviceId];
  if (!service) {
    throw new Error(`Unknown runtime service "${serviceId}"`);
  }

  visiting.add(serviceId);
  for (const dependencyId of service.dependsOn ?? []) {
    visitRuntimeService(topology, dependencyId, visiting, visited, ordered);
  }
  visiting.delete(serviceId);
  visited.add(serviceId);
  ordered.push({ id: serviceId, ...service });
}

export function resolveRuntimeServices(
  topology: RuntimeTopologyConfig,
  serviceIds: readonly string[],
): RuntimeTopologyService[] {
  const ordered: RuntimeTopologyService[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  for (const serviceId of serviceIds) {
    visitRuntimeService(topology, serviceId, visiting, visited, ordered);
  }

  return ordered;
}

export function resolveRuntimeProfileServices(
  topology: RuntimeTopologyConfig,
  profile: string,
): RuntimeTopologyService[] {
  const serviceIds = topology.profiles?.[profile];
  if (!serviceIds) {
    throw new Error(`Unknown runtime profile "${profile}"`);
  }
  return resolveRuntimeServices(topology, serviceIds);
}
