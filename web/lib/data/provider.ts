import type { PropertyRecord } from "../property-model.ts";
import type { PropertyDataProvider } from "../agents/property-context.ts";
import { WorkspacePropertyDataProvider } from "./workspace-provider.ts";
import { NycPropertyDataProvider } from "./nyc-provider.ts";

// Config-driven data source. The default is the workspace provider (the caller's
// own real records); setting the source to "nyc" swaps in live NYC Open Data.
// Nothing about the agent changes — both providers return the same PropertyContext.
export function createPropertyDataProvider(
  source: string | undefined,
  workspaceRecords?: PropertyRecord[],
): PropertyDataProvider {
  const choice = (source || "workspace").toLowerCase();
  if (choice === "nyc") return new NycPropertyDataProvider();
  return new WorkspacePropertyDataProvider(workspaceRecords);
}

export { WorkspacePropertyDataProvider, NycPropertyDataProvider };
export { contextFromRecord } from "./workspace-provider.ts";
