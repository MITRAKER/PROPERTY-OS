import { exchangeGoogleCode, isGoogleConfigured } from "../../../../lib/auth/google.ts";
import { createSessionToken, sessionCookieHeader } from "../../../../lib/auth/session.ts";
import { ensureUserAndWorkspace } from "../../../../db/repo";

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// Google redirects here with ?code&state. We verify state, exchange the code,
// provision the user + workspace, and set the session cookie.
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!isGoogleConfigured()) {
    return Response.redirect(new URL("/", url.origin).toString(), 302);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = readCookie(request, "pos_oauth_state");

  if (!code || !state || !expectedState || state !== expectedState) {
    return new Response("Invalid OAuth state.", { status: 400 });
  }

  try {
    const redirectUri = new URL("/api/auth/callback", url.origin).toString();
    const profile = await exchangeGoogleCode(code, redirectUri);
    const { user, workspace } = await ensureUserAndWorkspace(profile);
    const token = await createSessionToken({ userId: user.id, email: user.email, name: user.name, workspaceId: workspace.id });

    const headers = new Headers({ Location: new URL("/", url.origin).toString() });
    headers.append("Set-Cookie", sessionCookieHeader(token));
    headers.append("Set-Cookie", "pos_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0");
    return new Response(null, { status: 302, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-in failed.";
    return new Response(`Sign-in failed: ${message}`, { status: 502 });
  }
}
