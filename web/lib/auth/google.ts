// Google OAuth 2.0 authorization-code flow. Client credentials come from
// server-only env vars (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). When they are
// not set, the app runs in dev mode with a local fallback user (see the auth
// routes), so development works without configuring Google.

export type GoogleProfile = { sub: string; email: string; name: string };

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export function googleAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1] ?? "";
  const padded = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4);
  return JSON.parse(atob(padded)) as Record<string, unknown>;
}

// Exchanges the authorization code for tokens and returns the verified profile.
// The id_token is received directly from Google's token endpoint over TLS, so we
// trust it for the profile claims (a JWKS signature check can be added later).
export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<GoogleProfile> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) {
    throw new Error(`Google token exchange failed (${response.status}).`);
  }
  const tokens = (await response.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("Google did not return an id_token.");
  const payload = decodeJwtPayload(tokens.id_token);
  const sub = typeof payload.sub === "string" ? payload.sub : "";
  const email = typeof payload.email === "string" ? payload.email : "";
  if (!sub || !email) throw new Error("Google profile is missing a subject or email.");
  const name = typeof payload.name === "string" && payload.name ? payload.name : email;
  return { sub, email, name };
}
