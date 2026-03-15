import type { AnyAgentTool } from "../agents/tools/common.js";
import type { ChannelPlugin } from "../channels/plugins/types.js";
import { registerContextEngine as registerLegacyContextEngine } from "../context-engine/registry.js";
import type { GatewayRequestHandler } from "../gateway/server-methods/types.js";
import { registerInternalHook } from "../hooks/internal-hooks.js";
import type { PluginRecord, PluginRegistry } from "../plugins/registry.js";
import type {
  PluginHookHandlerMap,
  PluginHookName,
  OpenClawPluginApi,
  OpenClawPluginChannelRegistration,
  OpenClawPluginCliRegistrar,
  OpenClawPluginHookOptions,
  OpenClawPluginHttpRouteParams,
  OpenClawPluginService,
  OpenClawPluginToolFactory,
  PluginHookRegistration as TypedPluginHookRegistration,
} from "../plugins/types.js";
import {
  applyExtensionHostTypedHookPolicy,
  bridgeExtensionHostLegacyHooks,
} from "./hook-compat.js";
import { pushExtensionHostRegistryDiagnostic } from "./plugin-registry-compat.js";
import {
  addExtensionChannelRegistration,
  addExtensionCliRegistration,
  addExtensionContextEngineRegistration,
  addExtensionGatewayMethodRegistration,
  addExtensionLegacyHookRegistration,
  addExtensionHttpRouteRegistration,
  addExtensionServiceRegistration,
  addExtensionToolRegistration,
  addExtensionTypedHookRegistration,
} from "./registry-writes.js";
import {
  resolveExtensionChannelRegistration,
  resolveExtensionCliRegistration,
  resolveExtensionContextEngineRegistration,
  resolveExtensionGatewayMethodRegistration,
  resolveExtensionLegacyHookRegistration,
  resolveExtensionHttpRouteRegistration,
  resolveExtensionServiceRegistration,
  resolveExtensionToolRegistration,
  resolveExtensionTypedHookRegistration,
} from "./runtime-registrations.js";
import {
  getExtensionHostGatewayHandlers,
  listExtensionHostHttpRoutes,
} from "./runtime-registry.js";

export type PluginTypedHookPolicy = {
  allowPromptInjection?: boolean;
};

export function createExtensionHostPluginRegistrationActions(params: {
  registry: PluginRegistry;
  coreGatewayMethods: Set<string>;
}) {
  const { registry, coreGatewayMethods } = params;

  const registerTool = (
    record: PluginRecord,
    tool: AnyAgentTool | OpenClawPluginToolFactory,
    opts?: { name?: string; names?: string[]; optional?: boolean },
  ) => {
    const result = resolveExtensionToolRegistration({
      ownerPluginId: record.id,
      ownerSource: record.source,
      tool,
      opts,
    });
    addExtensionToolRegistration({ registry, record, names: result.names, entry: result.entry });
  };

  const registerHook = (
    record: PluginRecord,
    events: string | string[],
    handler: Parameters<typeof registerInternalHook>[1],
    opts: OpenClawPluginHookOptions | undefined,
    config: OpenClawPluginApi["config"],
  ) => {
    const normalized = resolveExtensionLegacyHookRegistration({
      ownerPluginId: record.id,
      ownerSource: record.source,
      events,
      handler,
      opts,
    });
    if (!normalized.ok) {
      pushExtensionHostRegistryDiagnostic({
        registry,
        level: "warn",
        pluginId: record.id,
        source: record.source,
        message: normalized.message,
      });
      return;
    }
    addExtensionLegacyHookRegistration({
      registry,
      record,
      hookName: normalized.hookName,
      entry: normalized.entry,
      events: normalized.events,
    });

    bridgeExtensionHostLegacyHooks({
      events: normalized.events,
      handler,
      hookSystemEnabled: config?.hooks?.internal?.enabled === true,
      register: opts?.register,
      registerHook: registerInternalHook,
    });
  };

  const registerGatewayMethod = (
    record: PluginRecord,
    method: string,
    handler: GatewayRequestHandler,
  ) => {
    const result = resolveExtensionGatewayMethodRegistration({
      existing: { ...getExtensionHostGatewayHandlers(registry) },
      coreGatewayMethods,
      method,
      handler,
    });
    if (!result.ok) {
      pushExtensionHostRegistryDiagnostic({
        registry,
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: result.message,
      });
      return;
    }
    addExtensionGatewayMethodRegistration({
      registry,
      record,
      method: result.method,
      handler: result.handler,
    });
  };

  const registerHttpRoute = (record: PluginRecord, route: OpenClawPluginHttpRouteParams) => {
    const result = resolveExtensionHttpRouteRegistration({
      existing: [...listExtensionHostHttpRoutes(registry)],
      ownerPluginId: record.id,
      ownerSource: record.source,
      route,
    });
    if (!result.ok) {
      pushExtensionHostRegistryDiagnostic({
        registry,
        level: result.message === "http route registration missing path" ? "warn" : "error",
        pluginId: record.id,
        source: record.source,
        message: result.message,
      });
      return;
    }
    if (result.action === "replace") {
      addExtensionHttpRouteRegistration({
        registry,
        record,
        action: "replace",
        existingIndex: result.existingIndex,
        entry: result.entry,
      });
      return;
    }
    addExtensionHttpRouteRegistration({
      registry,
      record,
      action: "append",
      entry: result.entry,
    });
  };

  const registerChannel = (
    record: PluginRecord,
    registration: OpenClawPluginChannelRegistration | ChannelPlugin,
  ) => {
    const result = resolveExtensionChannelRegistration({
      existing: registry.channels,
      ownerPluginId: record.id,
      ownerSource: record.source,
      registration,
    });
    if (!result.ok) {
      pushExtensionHostRegistryDiagnostic({
        registry,
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: result.message,
      });
      return;
    }
    addExtensionChannelRegistration({
      registry,
      record,
      channelId: result.channelId,
      entry: result.entry,
    });
  };

  const registerCli = (
    record: PluginRecord,
    registrar: OpenClawPluginCliRegistrar,
    opts?: { commands?: string[] },
  ) => {
    const result = resolveExtensionCliRegistration({
      ownerPluginId: record.id,
      ownerSource: record.source,
      registrar,
      opts,
    });
    addExtensionCliRegistration({
      registry,
      record,
      commands: result.commands,
      entry: result.entry,
    });
  };

  const registerService = (record: PluginRecord, service: OpenClawPluginService) => {
    const result = resolveExtensionServiceRegistration({
      ownerPluginId: record.id,
      ownerSource: record.source,
      service,
    });
    if (!result.ok) {
      return;
    }
    addExtensionServiceRegistration({
      registry,
      record,
      serviceId: result.serviceId,
      entry: result.entry,
    });
  };

  const registerTypedHook = <K extends PluginHookName>(
    record: PluginRecord,
    hookName: K,
    handler: PluginHookHandlerMap[K],
    opts?: { priority?: number },
    policy?: PluginTypedHookPolicy,
  ) => {
    const normalized = resolveExtensionTypedHookRegistration({
      ownerPluginId: record.id,
      ownerSource: record.source,
      hookName,
      handler,
      priority: opts?.priority,
    });
    if (!normalized.ok) {
      pushExtensionHostRegistryDiagnostic({
        registry,
        level: "warn",
        pluginId: record.id,
        source: record.source,
        message: normalized.message,
      });
      return;
    }
    const policyResult = applyExtensionHostTypedHookPolicy({
      hookName: normalized.hookName,
      handler,
      policy,
      blockedMessage: `typed hook "${normalized.hookName}" blocked by plugins.entries.${record.id}.hooks.allowPromptInjection=false`,
      constrainedMessage: `typed hook "${normalized.hookName}" prompt fields constrained by plugins.entries.${record.id}.hooks.allowPromptInjection=false`,
    });
    if (!policyResult.ok) {
      pushExtensionHostRegistryDiagnostic({
        registry,
        level: "warn",
        pluginId: record.id,
        source: record.source,
        message: policyResult.message,
      });
      return;
    }
    if (policyResult.warningMessage) {
      pushExtensionHostRegistryDiagnostic({
        registry,
        level: "warn",
        pluginId: record.id,
        source: record.source,
        message: policyResult.warningMessage,
      });
    }
    addExtensionTypedHookRegistration({
      registry,
      record,
      entry: {
        ...normalized.entry,
        pluginId: record.id,
        hookName: normalized.hookName,
        handler: policyResult.entryHandler,
      } as TypedPluginHookRegistration,
    });
  };

  const registerContextEngine = (
    record: PluginRecord,
    engineId: string,
    factory: Parameters<typeof registerLegacyContextEngine>[1],
  ) => {
    const result = resolveExtensionContextEngineRegistration({
      engineId,
      factory,
    });
    if (!result.ok) {
      pushExtensionHostRegistryDiagnostic({
        registry,
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: result.message,
      });
      return;
    }
    addExtensionContextEngineRegistration({
      entry: result.entry,
      registerEngine: registerLegacyContextEngine,
    });
  };

  return {
    registerTool,
    registerHook,
    registerGatewayMethod,
    registerHttpRoute,
    registerChannel,
    registerCli,
    registerService,
    registerTypedHook,
    registerContextEngine,
  };
}
