import { readSessionCookie, verifySessionToken } from "./session.ts";
import { isGoogleConfigured } from "./google.ts";
import { runWithAuth, type AuthContext } from "./context.ts";
import { ensureUserAndWorkspace } from "../../db/repo";

// The dev fallback identity, used only when Google is not configured so the app
// is fully usable in local development without signing in.
export const DEV_PROFILE = { sub: "dev-local", email: "dev@local", name: "Local Developer" };

// Resolves the caller's identity + workspace. Returns null only when login is
// required (production with Google configured and no valid session).
export async function resolveAuth(request: Request): Promise<AuthContext | null> {
  const claims = await verifySessionToken(readSessionCookie(request));
  if (claims) {
    return { userId: claims.userId, workspaceId: claims.workspaceId, email: claims.email, name: claims.name };
  }

  if (!isGoogleConfigured()) {
    const { user, workspace } = await ensureUserAndWorkspace(DEV_PROFILE);
    return { userId: user.id, workspaceId: workspace.id, email: user.email, name: user.name };
  }

  return null;
}

// Wraps a route handler: gates on authentication and runs the handler inside the
// request's auth context so the repository scopes every query to the workspace.
export async function withAuth(request: Request, handler: () => Promise<Response>): Promise<Response> {
  const auth = await resolveAuth(request);
  if (!auth) {
    return Response.json({ error: "Not authenticated." }, { status: 401 });
  }
  return runWithAuth(auth, handler);
}
