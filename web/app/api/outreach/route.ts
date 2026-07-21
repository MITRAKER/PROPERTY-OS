import { prepareOutreach } from "../../../lib/outreach.ts";
import type { Channel, OutreachRequest } from "../../../lib/outreach.ts";

const CHANNELS: Channel[] = ["email", "phone", "text", "letter"];

function isValidRequest(body: unknown): body is OutreachRequest {
  if (typeof body !== "object" || body === null) return false;
  const value = body as Record<string, unknown>;

  if (typeof value.propertyId !== "string" || value.propertyId.trim().length === 0) return false;
  if (typeof value.channel !== "string" || !CHANNELS.includes(value.channel as Channel)) return false;

  const propertyContext = value.propertyContext as Record<string, unknown> | undefined;
  if (typeof propertyContext?.address !== "string" || typeof propertyContext?.ownerName !== "string") return false;

  const relationshipContext = value.relationshipContext;
  if (typeof relationshipContext !== "object" || relationshipContext === null) return false;

  const permissions = value.permissions as Record<string, unknown> | undefined;
  if (typeof permissions?.doNotContact !== "boolean") return false;

  return true;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!isValidRequest(body)) {
      return Response.json(
        { error: "Provide propertyId, channel, propertyContext.address/ownerName, relationshipContext, and permissions.doNotContact." },
        { status: 400 },
      );
    }

    return Response.json(prepareOutreach(body));
  } catch {
    return Response.json({ error: "The outreach draft could not be generated." }, { status: 400 });
  }
}
