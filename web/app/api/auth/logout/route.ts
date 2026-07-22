import { clearSessionCookieHeader } from "../../../../lib/auth/session.ts";

export async function POST(request: Request) {
  const origin = new URL(request.url).origin;
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Set-Cookie": clearSessionCookieHeader(), "X-Origin": origin },
  });
}
