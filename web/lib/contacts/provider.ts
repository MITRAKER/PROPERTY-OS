import type { ContactRecord } from "./contact-model.ts";
import { normalizeEmail, normalizePhone, splitOwnerName } from "./contact-model.ts";

// Vendor-agnostic contact lookup ("skip tracing").
//
// No free source of homeowner phone numbers exists, so this seam exists to keep
// the paid vendor swappable and to keep every number that enters the workspace
// under the same compliance gate. Adding a vendor must never require touching the
// agents, the UI, or the permission logic.

export type ContactLookupInput = {
  propertyId: string;
  address: string;
  ownerName: string;
  mailingAddress?: string | null;
};

export type ContactLookupStatus = "found" | "not_found" | "not_configured" | "failed";

export type ContactLookupResult = {
  status: ContactLookupStatus;
  provider: string;
  contacts: ContactRecord[];
  detail: string;
};

export interface ContactDataProvider {
  readonly name: string;
  isConfigured(): boolean;
  lookup(input: ContactLookupInput): Promise<ContactLookupResult>;
}

// Default. Reports honestly that no vendor is wired rather than pretending.
export class UnconfiguredContactProvider implements ContactDataProvider {
  readonly name = "none";
  isConfigured(): boolean {
    return false;
  }
  async lookup(): Promise<ContactLookupResult> {
    return {
      status: "not_configured",
      provider: this.name,
      contacts: [],
      detail:
        "No contact-data vendor is configured. Add numbers manually, or export the skip-trace CSV and import the results — that is the cheapest path.",
    };
  }
}

// --- Helpers (exported for testing) --------------------------------------

// Split a single-line mailing address into the parts vendors ask for.
// "99 PARK AVE, NEW YORK, NY 10016" -> street/city/state/zip. Never throws.
export function parseMailingAddress(mailing?: string | null): {
  street: string;
  city: string;
  state: string;
  zip: string;
} {
  const text = (mailing ?? "").trim();
  const zip = (text.match(/\b(\d{5})(?:-\d{4})?\b/) ?? [])[1] ?? "";
  const state = (text.match(/\b([A-Za-z]{2})\b(?=,?\s*\d{5}\b|\s*$)/) ?? [])[1]?.toUpperCase() ?? "";
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  const street = parts[0] ?? "";
  // City is the second comma-part, minus any trailing state/zip.
  const city = (parts[1] ?? "").replace(/\b[A-Za-z]{2}\b\s*\d{5}(?:-\d{4})?\s*$/, "").replace(/\s*\d{5}(?:-\d{4})?\s*$/, "").trim();
  return { street, city, state, zip };
}

const PHONE_KEY = /(phone|mobile|cell|landline|number|tel)/i;
const MOBILE_KEY = /(mobile|cell)/i;
const LANDLINE_KEY = /(landline|home)/i;

// Deep-scan any JSON payload for phone/email values. Vendors differ wildly in
// response shape, so rather than bind to one schema we harvest by key hint —
// anything under a key mentioning phone/mobile/email is normalised and kept.
export function harvestContacts(payload: unknown, source: string): ContactRecord[] {
  const found: ContactRecord[] = [];
  const seen = new Set<string>();

  const push = (type: "phone" | "email", value: string, label: string) => {
    if (seen.has(value)) return;
    seen.add(value);
    found.push({ type, value, label, source });
  };

  const visit = (node: unknown, keyHint: string) => {
    if (node === null || node === undefined) return;
    if (typeof node === "string" || typeof node === "number") {
      const raw = String(node);
      const email = normalizeEmail(raw);
      if (email && (/mail/i.test(keyHint) || raw.includes("@"))) {
        push("email", email, "");
        return;
      }
      if (PHONE_KEY.test(keyHint)) {
        const phone = normalizePhone(raw);
        if (phone) {
          const label = MOBILE_KEY.test(keyHint) ? "mobile" : LANDLINE_KEY.test(keyHint) ? "landline" : "";
          push("phone", phone, label);
        }
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, keyHint);
      return;
    }
    if (typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) visit(value, key);
    }
  };

  visit(payload, "");
  return found;
}

type HttpProviderOptions = {
  name: string;
  url: string;
  key: string;
  authHeader: string;
  authScheme: string;
  bodyStyle: "batchdata" | "flat";
  fetchImpl?: typeof fetch;
};

/**
 * One HTTP adapter that fits most skip-trace vendors. It sends the owner name +
 * mailing address, then harvests phones/emails from whatever JSON comes back, so
 * only the request URL, key, and (optionally) body shape differ per vendor.
 *
 * Marketing use of this data is generally fine; using it for tenant screening or
 * any credit decision puts you under FCRA, which these vendors are not sold for.
 */
export class HttpSkipTraceProvider implements ContactDataProvider {
  readonly name: string;
  private readonly url: string;
  private readonly key: string;
  private readonly authHeader: string;
  private readonly authScheme: string;
  private readonly bodyStyle: "batchdata" | "flat";
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpProviderOptions) {
    this.name = options.name;
    this.url = options.url;
    this.key = options.key;
    this.authHeader = options.authHeader || "Authorization";
    this.authScheme = options.authScheme ?? "Bearer";
    this.bodyStyle = options.bodyStyle;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.url && this.key);
  }

  private buildBody(input: ContactLookupInput) {
    const { first, last } = splitOwnerName(input.ownerName);
    const addr = parseMailingAddress(input.mailingAddress || input.address);
    if (this.bodyStyle === "batchdata") {
      return {
        requests: [
          {
            name: { first, last },
            propertyAddress: { street: addr.street, city: addr.city, state: addr.state, zip: addr.zip },
          },
        ],
      };
    }
    return {
      firstName: first,
      lastName: last,
      fullName: input.ownerName,
      street: addr.street,
      city: addr.city,
      state: addr.state,
      zip: addr.zip,
      mailingAddress: input.mailingAddress ?? input.address,
    };
  }

  async lookup(input: ContactLookupInput): Promise<ContactLookupResult> {
    if (!this.isConfigured()) {
      return {
        status: "not_configured",
        provider: this.name,
        contacts: [],
        detail: `${this.name} is selected but SKIPTRACE_API_URL and SKIPTRACE_API_KEY are not both set.`,
      };
    }
    try {
      const response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [this.authHeader]: `${this.authScheme} ${this.key}`.trim(),
        },
        body: JSON.stringify(this.buildBody(input)),
      });
      if (!response.ok) {
        return {
          status: "failed",
          provider: this.name,
          contacts: [],
          detail: `${this.name} returned HTTP ${response.status}.`,
        };
      }
      const payload = (await response.json()) as unknown;
      const contacts = harvestContacts(payload, this.name);
      if (contacts.length === 0) {
        return {
          status: "not_found",
          provider: this.name,
          contacts: [],
          detail: `${this.name} found no phone or email on record for this owner.`,
        };
      }
      return {
        status: "found",
        provider: this.name,
        contacts,
        detail: `Found ${contacts.length} contact detail(s) via ${this.name}.`,
      };
    } catch (error) {
      return {
        status: "failed",
        provider: this.name,
        contacts: [],
        detail: error instanceof Error ? error.message : "The skip-trace request failed.",
      };
    }
  }
}

/**
 * Selecting a vendor is pure configuration — no code change:
 *
 *   BatchData:  CONTACT_DATA_PROVIDER=batchdata  SKIPTRACE_API_KEY=...
 *   Any other:  CONTACT_DATA_PROVIDER=<name>     SKIPTRACE_API_URL=...  SKIPTRACE_API_KEY=...
 *               (optional) SKIPTRACE_AUTH_HEADER, SKIPTRACE_AUTH_SCHEME, SKIPTRACE_BODY_STYLE
 *
 * Storage, permissions, the compliance gate and the UI all already work off
 * ContactRecord, so nothing downstream changes.
 */
export function createContactDataProvider(source?: string): ContactDataProvider {
  const choice = (source || process.env.CONTACT_DATA_PROVIDER || "none").toLowerCase();
  if (!choice || choice === "none") return new UnconfiguredContactProvider();

  if (choice === "batchdata") {
    return new HttpSkipTraceProvider({
      name: "batchdata",
      url: process.env.SKIPTRACE_API_URL || "https://api.batchdata.com/api/v1/property/skip-trace",
      key: process.env.SKIPTRACE_API_KEY || "",
      authHeader: process.env.SKIPTRACE_AUTH_HEADER || "Authorization",
      authScheme: process.env.SKIPTRACE_AUTH_SCHEME ?? "Bearer",
      bodyStyle: "batchdata",
    });
  }

  // Any other vendor name works through the generic adapter, as long as an
  // endpoint is configured; otherwise report unconfigured rather than failing.
  if (process.env.SKIPTRACE_API_URL) {
    const bodyStyle = process.env.SKIPTRACE_BODY_STYLE === "batchdata" ? "batchdata" : "flat";
    return new HttpSkipTraceProvider({
      name: choice,
      url: process.env.SKIPTRACE_API_URL,
      key: process.env.SKIPTRACE_API_KEY || "",
      authHeader: process.env.SKIPTRACE_AUTH_HEADER || "Authorization",
      authScheme: process.env.SKIPTRACE_AUTH_SCHEME ?? "Bearer",
      bodyStyle,
    });
  }

  return new UnconfiguredContactProvider();
}

export function contactProviderStatus() {
  const provider = createContactDataProvider();
  return { name: provider.name, configured: provider.isConfigured() };
}
