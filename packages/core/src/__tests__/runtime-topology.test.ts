import { describe, expect, it } from "vitest";
import { resolveRuntimeProfileServices, resolveRuntimeServices } from "../runtime-topology.js";
import type { RuntimeTopologyConfig } from "../types.js";

describe("runtime topology helpers", () => {
  const topology: RuntimeTopologyConfig = {
    services: {
      gcs: { ownerRepo: "Sprig-Aerospace/gcs" },
      "ag-service": { ownerRepo: "Sprig-Aerospace/ag-service", dependsOn: ["gcs"] },
      "px4-bridge": {
        ownerRepo: "Sprig-Aerospace/px4-bridge",
        dependsOn: ["ag-service"],
      },
      px4: { ownerRepo: "PX4/PX4-Autopilot", dependsOn: ["px4-bridge"] },
      "x-plane-plugin": {
        ownerRepo: "Sprig-Aerospace/x-plane-plugin",
        dependsOn: ["px4-bridge"],
      },
    },
    profiles: {
      sitl: ["px4", "x-plane-plugin"],
    },
  };

  it("resolves transitive dependencies before dependents", () => {
    expect(resolveRuntimeServices(topology, ["px4"]).map((service) => service.id)).toEqual([
      "gcs",
      "ag-service",
      "px4-bridge",
      "px4",
    ]);
  });

  it("resolves named profiles through the service map", () => {
    expect(resolveRuntimeProfileServices(topology, "sitl").map((service) => service.id)).toEqual([
      "gcs",
      "ag-service",
      "px4-bridge",
      "px4",
      "x-plane-plugin",
    ]);
  });

  it("throws for unknown profiles", () => {
    expect(() => resolveRuntimeProfileServices(topology, "hwil")).toThrow(
      'Unknown runtime profile "hwil"',
    );
  });
});
