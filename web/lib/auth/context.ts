import { AsyncLocalStorage } from "node:async_hooks";

// Request-scoped identity. Set once per request by the auth gate, then read by
// the repository so every query is automatically scoped to the caller's
// workspace without threading the id through every function signature.
export type AuthContext = {
  userId: string;
  workspaceId: string;
  email: string;
  name: string;
};

const storage = new AsyncLocalStorage<AuthContext>();

export function runWithAuth<T>(context: AuthContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentAuth(): AuthContext | null {
  return storage.getStore() ?? null;
}

export function currentWorkspaceId(): string {
  const store = storage.getStore();
  if (!store) throw new Error("No workspace in context. This query must run inside an authenticated request.");
  return store.workspaceId;
}
