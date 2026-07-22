import { SCORING_VERSION } from "../../../lib/scoring.ts";
import { deliveryCapabilities } from "../../../lib/outreach/delivery.ts";
import { contactProviderStatus } from "../../../lib/contacts/provider.ts";

// Read-only, non-secret runtime configuration for the Settings view. Never
// returns the API key itself — only whether one is configured.
export async function GET() {
  return Response.json({
    propertyDataProvider: process.env.PROPERTY_DATA_PROVIDER || "workspace",
    anthropicModel: process.env.ANTHROPIC_MODEL || "claude-haiku-4-5",
    anthropicFallbackModel: process.env.ANTHROPIC_FALLBACK_MODEL || "claude-opus-4-8",
    opusFallbackEnabled: process.env.ANTHROPIC_ENABLE_OPUS_FALLBACK === "true",
    anthropicKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    scoringVersion: SCORING_VERSION,
    appName: process.env.NEXT_PUBLIC_APP_NAME || "Property OS",
    delivery: deliveryCapabilities(),
    contactProvider: contactProviderStatus(),
  });
}
