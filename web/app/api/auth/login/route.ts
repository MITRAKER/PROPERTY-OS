import { googleAuthUrl, isGoogleConfigured } from "../../../../lib/auth/google.ts";

// Starts the Google OAuth flow. If Google is not configured (local dev), there is
// nothing to log into — the app auto-provisions a local user — so redirect home.
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!isGoogleConfigured()) {
    return Response.redirect(new URL("/", url.origin).toString(), 302);
  }
  const redirectUri = new URL("/api/auth/callback", url.origin).toString();
  const state = crypto.randomUUID();
  const authUrl = googleAuthUrl(redirectUri, state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl,
      // Bind the state to the browser to mitigate CSRF on the callback.
      "Set-Cookie": `pos_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600`,
    },
  });
}
