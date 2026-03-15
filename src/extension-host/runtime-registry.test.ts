import { describe, expect, it, vi } from "vitest";
import { createEmptyPluginRegistry } from "../plugins/registry.js";
import {
  addExtensionHostHttpRoute,
  getExtensionHostGatewayHandlers,
  hasExtensionHostRuntimeEntries,
  listExtensionHostCliRegistrations,
  listExtensionHostHttpRoutes,
  listExtensionHostProviderRegistrations,
  listExtensionHostServiceRegistrations,
  listExtensionHostToolRegistrations,
  removeExtensionHostHttpRoute,
  replaceExtensionHostHttpRoute,
  setExtensionHostGatewayHandler,
} from "./runtime-registry.js";

describe("extension host runtime registry accessors", () => {
  it("detects runtime entries across non-tool surfaces", () => {
    const providerRegistry = createEmptyPluginRegistry();
    providerRegistry.providers.push({
      pluginId: "provider-demo",
      source: "test",
      provider: {
        id: "provider-demo",
        label: "Provider Demo",
        auth: [],
      },
    });
    expect(hasExtensionHostRuntimeEntries(providerRegistry)).toBe(true);

    const routeRegistry = createEmptyPluginRegistry();
    addExtensionHostHttpRoute(routeRegistry, {
      path: "/plugins/demo",
      handler: vi.fn(),
      auth: "plugin",
      match: "exact",
      pluginId: "route-demo",
      source: "test",
    });
    expect(hasExtensionHostRuntimeEntries(routeRegistry)).toBe(true);

    const gatewayRegistry = createEmptyPluginRegistry();
    setExtensionHostGatewayHandler({
      registry: gatewayRegistry,
      method: "demo.echo",
      handler: vi.fn(),
    });
    expect(hasExtensionHostRuntimeEntries(gatewayRegistry)).toBe(true);
  });

  it("returns stable empty views for missing registries", () => {
    expect(hasExtensionHostRuntimeEntries(null)).toBe(false);
    expect(listExtensionHostProviderRegistrations(null)).toEqual([]);
    expect(listExtensionHostToolRegistrations(null)).toEqual([]);
    expect(listExtensionHostServiceRegistrations(null)).toEqual([]);
    expect(listExtensionHostCliRegistrations(null)).toEqual([]);
    expect(listExtensionHostHttpRoutes(null)).toEqual([]);
    expect(getExtensionHostGatewayHandlers(null)).toEqual({});
  });

  it("projects existing registry collections without copying them", () => {
    const registry = createEmptyPluginRegistry();
    registry.tools.push({
      pluginId: "tool-demo",
      optional: false,
      source: "test",
      names: ["tool_demo"],
      factory: () => ({
        name: "tool_demo",
        description: "tool demo",
        parameters: { type: "object", properties: {} },
        async execute() {
          return { content: [{ type: "text", text: "ok" }] };
        },
      }),
    });
    registry.services.push({
      pluginId: "svc-demo",
      source: "test",
      service: {
        id: "svc-demo",
        start: () => undefined,
      },
    });
    registry.cliRegistrars.push({
      pluginId: "cli-demo",
      source: "test",
      commands: ["demo"],
      register: () => undefined,
    });
    addExtensionHostHttpRoute(registry, {
      path: "/plugins/demo",
      handler: vi.fn(),
      auth: "plugin",
      match: "exact",
      pluginId: "route-demo",
      source: "test",
    });
    const handler = vi.fn();
    setExtensionHostGatewayHandler({
      registry,
      method: "demo.echo",
      handler,
    });

    expect(listExtensionHostToolRegistrations(registry)).toBe(registry.tools);
    expect(listExtensionHostServiceRegistrations(registry)).toBe(registry.services);
    expect(listExtensionHostCliRegistrations(registry)).toBe(registry.cliRegistrars);
    expect(listExtensionHostHttpRoutes(registry)).toEqual(registry.httpRoutes);
    expect(getExtensionHostGatewayHandlers(registry)).toEqual(registry.gatewayHandlers);
    expect(getExtensionHostGatewayHandlers(registry)["demo.echo"]).toBe(handler);
  });

  it("keeps legacy route and gateway mirrors synchronized with host-owned state", () => {
    const registry = createEmptyPluginRegistry();
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    const entry = {
      path: "/plugins/demo",
      handler: firstHandler,
      auth: "plugin" as const,
      match: "exact" as const,
      pluginId: "route-demo",
      source: "test",
    };

    addExtensionHostHttpRoute(registry, entry);
    setExtensionHostGatewayHandler({
      registry,
      method: "demo.echo",
      handler: firstHandler,
    });
    replaceExtensionHostHttpRoute({
      registry,
      index: 0,
      entry: { ...entry, handler: secondHandler },
    });
    removeExtensionHostHttpRoute(registry, entry);

    expect(registry.httpRoutes).toHaveLength(1);
    expect(registry.httpRoutes[0]?.handler).toBe(secondHandler);
    expect(getExtensionHostGatewayHandlers(registry)).toEqual(registry.gatewayHandlers);
  });
});
