import { resolveAuth } from "../../../lib/auth/server.ts";
import { runWithAuth } from "../../../lib/auth/context.ts";
import { isGoogleConfigured } from "../../../lib/auth/google.ts";
import { getWorkspaceSummary } from "../../../db/repo";

// Reports the current identity and workspace. Never hard-gates: the frontend uses
// `needsLogin` to decide whether to show the sign-in screen.
export async function GET(request: Request) {
  const auth = await resolveAuth(request);
  if (!auth) {
    return Response.json({ user: null, workspace: null, needsLogin: isGoogleConfigured() });
  }
  const workspace = await runWithAuth(auth, () => getWorkspaceSummary());
  return Response.json({
    user: { displayName: auth.name, email: auth.email },
    workspace,
    needsLogin: false,
  });
}
