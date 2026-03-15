import type { GatewayRequestHandlers } from "../gateway/server-methods/types.js";
import type {
  PluginCliRegistration,
  PluginHttpRouteRegistration,
  PluginProviderRegistration,
  PluginRegistry,
  PluginServiceRegistration,
  PluginToolRegistration,
} from "../plugins/registry.js";

const EMPTY_PROVIDERS: readonly PluginProviderRegistration[] = [];
const EMPTY_TOOLS: readonly PluginToolRegistration[] = [];
const EMPTY_SERVICES: readonly PluginServiceRegistration[] = [];
const EMPTY_CLI_REGISTRARS: readonly PluginCliRegistration[] = [];
const EMPTY_HTTP_ROUTES: readonly PluginHttpRouteRegistration[] = [];
const EMPTY_GATEWAY_HANDLERS: Readonly<GatewayRequestHandlers> = Object.freeze({});
const EXTENSION_HOST_RUNTIME_REGISTRY_STATE = Symbol.for("openclaw.extensionHostRuntimeRegistry");

type ExtensionHostRuntimeRegistryState = {
  httpRoutes: PluginHttpRouteRegistration[];
  legacyHttpRoutes: PluginHttpRouteRegistration[];
  gatewayHandlers: GatewayRequestHandlers;
  legacyGatewayHandlers: GatewayRequestHandlers;
};

type RuntimeRegistryBackedPluginRegistry = Pick<
  PluginRegistry,
  "httpRoutes" | "gatewayHandlers"
> & {
  [EXTENSION_HOST_RUNTIME_REGISTRY_STATE]?: ExtensionHostRuntimeRegistryState;
};

function ensureExtensionHostRuntimeRegistryState(
  registry: RuntimeRegistryBackedPluginRegistry,
): ExtensionHostRuntimeRegistryState {
  if (registry[EXTENSION_HOST_RUNTIME_REGISTRY_STATE]) {
    return registry[EXTENSION_HOST_RUNTIME_REGISTRY_STATE];
  }

  const legacyHttpRoutes = registry.httpRoutes ?? [];
  registry.httpRoutes = legacyHttpRoutes;
  const legacyGatewayHandlers = registry.gatewayHandlers ?? {};
  registry.gatewayHandlers = legacyGatewayHandlers;

  const state: ExtensionHostRuntimeRegistryState = {
    httpRoutes: [...legacyHttpRoutes],
    legacyHttpRoutes,
    gatewayHandlers: { ...legacyGatewayHandlers },
    legacyGatewayHandlers,
  };
  registry[EXTENSION_HOST_RUNTIME_REGISTRY_STATE] = state;
  return state;
}

function syncLegacyHttpRoutes(state: ExtensionHostRuntimeRegistryState): void {
  state.legacyHttpRoutes.splice(0, state.legacyHttpRoutes.length, ...state.httpRoutes);
}

function syncLegacyGatewayHandlers(state: ExtensionHostRuntimeRegistryState): void {
  for (const key of Object.keys(state.legacyGatewayHandlers)) {
    if (!(key in state.gatewayHandlers)) {
      delete state.legacyGatewayHandlers[key];
    }
  }
  Object.assign(state.legacyGatewayHandlers, state.gatewayHandlers);
}

export function hasExtensionHostRuntimeEntries(
  registry:
    | Pick<
        PluginRegistry,
        | "plugins"
        | "channels"
        | "tools"
        | "providers"
        | "gatewayHandlers"
        | "httpRoutes"
        | "cliRegistrars"
        | "services"
        | "commands"
        | "hooks"
        | "typedHooks"
      >
    | null
    | undefined,
): boolean {
  if (!registry) {
    return false;
  }
  return (
    registry.plugins.length > 0 ||
    registry.channels.length > 0 ||
    registry.tools.length > 0 ||
    registry.providers.length > 0 ||
    Object.keys(getExtensionHostGatewayHandlers(registry)).length > 0 ||
    listExtensionHostHttpRoutes(registry).length > 0 ||
    registry.cliRegistrars.length > 0 ||
    registry.services.length > 0 ||
    registry.commands.length > 0 ||
    registry.hooks.length > 0 ||
    registry.typedHooks.length > 0
  );
}

export function listExtensionHostProviderRegistrations(
  registry: Pick<PluginRegistry, "providers"> | null | undefined,
): readonly PluginProviderRegistration[] {
  return registry?.providers ?? EMPTY_PROVIDERS;
}

export function listExtensionHostToolRegistrations(
  registry: Pick<PluginRegistry, "tools"> | null | undefined,
): readonly PluginToolRegistration[] {
  return registry?.tools ?? EMPTY_TOOLS;
}

export function listExtensionHostServiceRegistrations(
  registry: Pick<PluginRegistry, "services"> | null | undefined,
): readonly PluginServiceRegistration[] {
  return registry?.services ?? EMPTY_SERVICES;
}

export function listExtensionHostCliRegistrations(
  registry: Pick<PluginRegistry, "cliRegistrars"> | null | undefined,
): readonly PluginCliRegistration[] {
  return registry?.cliRegistrars ?? EMPTY_CLI_REGISTRARS;
}

export function listExtensionHostHttpRoutes(
  registry: Pick<PluginRegistry, "httpRoutes" | "gatewayHandlers"> | null | undefined,
): readonly PluginHttpRouteRegistration[] {
  if (!registry) {
    return EMPTY_HTTP_ROUTES;
  }
  return ensureExtensionHostRuntimeRegistryState(registry as RuntimeRegistryBackedPluginRegistry)
    .httpRoutes;
}

export function getExtensionHostGatewayHandlers(
  registry: Pick<PluginRegistry, "httpRoutes" | "gatewayHandlers"> | null | undefined,
): Readonly<GatewayRequestHandlers> {
  if (!registry) {
    return EMPTY_GATEWAY_HANDLERS;
  }
  return ensureExtensionHostRuntimeRegistryState(registry as RuntimeRegistryBackedPluginRegistry)
    .gatewayHandlers;
}

export function addExtensionHostHttpRoute(
  registry: Pick<PluginRegistry, "httpRoutes" | "gatewayHandlers">,
  entry: PluginHttpRouteRegistration,
): void {
  const state = ensureExtensionHostRuntimeRegistryState(
    registry as RuntimeRegistryBackedPluginRegistry,
  );
  state.httpRoutes.push(entry);
  syncLegacyHttpRoutes(state);
}

export function replaceExtensionHostHttpRoute(params: {
  registry: Pick<PluginRegistry, "httpRoutes" | "gatewayHandlers">;
  index: number;
  entry: PluginHttpRouteRegistration;
}): void {
  const state = ensureExtensionHostRuntimeRegistryState(
    params.registry as RuntimeRegistryBackedPluginRegistry,
  );
  state.httpRoutes[params.index] = params.entry;
  syncLegacyHttpRoutes(state);
}

export function removeExtensionHostHttpRoute(
  registry: Pick<PluginRegistry, "httpRoutes" | "gatewayHandlers">,
  entry: PluginHttpRouteRegistration,
): void {
  const state = ensureExtensionHostRuntimeRegistryState(
    registry as RuntimeRegistryBackedPluginRegistry,
  );
  const index = state.httpRoutes.indexOf(entry);
  if (index < 0) {
    return;
  }
  state.httpRoutes.splice(index, 1);
  syncLegacyHttpRoutes(state);
}

export function setExtensionHostGatewayHandler(params: {
  registry: Pick<PluginRegistry, "httpRoutes" | "gatewayHandlers">;
  method: string;
  handler: GatewayRequestHandlers[string];
}): void {
  const state = ensureExtensionHostRuntimeRegistryState(
    params.registry as RuntimeRegistryBackedPluginRegistry,
  );
  state.gatewayHandlers[params.method] = params.handler;
  syncLegacyGatewayHandlers(state);
}
