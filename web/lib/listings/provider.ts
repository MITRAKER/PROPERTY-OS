export type ListingBoard = "rebny_rls" | "trreb";

export type ListingBoardCapability = {
  board: ListingBoard;
  label: string;
  market: string;
  configured: boolean;
  requirement: string;
};

export type ActiveListing = {
  id: string;
  listingId: string;
  address: string;
  city: string;
  region: string;
  postalCode: string;
  listPrice: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  propertyType: string;
  latitude: number | null;
  longitude: number | null;
  modifiedAt: string | null;
  source: string;
};

export type ListingSearchResult = {
  board: ListingBoard;
  source: string;
  retrievedAt: string;
  listings: ActiveListing[];
};

type ResoRecord = Record<string, unknown>;
type FetchLike = typeof fetch;

type ResoConfig = {
  board: ListingBoard;
  label: string;
  propertyUrl: string;
  accessToken: string;
  fetchImpl?: FetchLike;
};

const BOARD_DETAILS: Record<ListingBoard, Omit<ListingBoardCapability, "configured">> = {
  rebny_rls: {
    board: "rebny_rls",
    label: "REBNY RLS",
    market: "New York City",
    requirement: "REBNY/RLS authorization and an executed IDX or data-feed agreement",
  },
  trreb: {
    board: "trreb",
    label: "TRREB",
    market: "Greater Toronto Area",
    requirement: "TRREB membership/authorization and an executed VOW, IDX, or data-feed agreement",
  },
};

function envConfig(board: ListingBoard): ResoConfig {
  if (board === "rebny_rls") {
    return {
      board,
      label: BOARD_DETAILS[board].label,
      propertyUrl: process.env.REBNY_RESO_PROPERTY_URL?.trim() ?? "",
      accessToken: process.env.REBNY_RESO_ACCESS_TOKEN?.trim() ?? "",
    };
  }
  return {
    board,
    label: BOARD_DETAILS[board].label,
    propertyUrl: process.env.TRREB_RESO_PROPERTY_URL?.trim() ?? "",
    accessToken: process.env.TRREB_RESO_ACCESS_TOKEN?.trim() ?? "",
  };
}

export function isListingBoard(value: unknown): value is ListingBoard {
  return value === "rebny_rls" || value === "trreb";
}

export function listingBoardCapabilities(): ListingBoardCapability[] {
  return (Object.keys(BOARD_DETAILS) as ListingBoard[]).map((board) => {
    const config = envConfig(board);
    return {
      ...BOARD_DETAILS[board],
      configured: Boolean(config.propertyUrl && config.accessToken),
    };
  });
}

function optionalNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function optionalText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function listingAddress(record: ResoRecord): string {
  const unparsed = optionalText(record.UnparsedAddress);
  if (unparsed) return unparsed;
  return [
    optionalText(record.StreetNumber),
    optionalText(record.StreetDirPrefix),
    optionalText(record.StreetName),
    optionalText(record.StreetSuffix),
    optionalText(record.UnitNumber) ? `#${optionalText(record.UnitNumber)}` : "",
  ].filter(Boolean).join(" ");
}

function mapListing(record: ResoRecord, source: string, index: number): ActiveListing {
  const listingId = optionalText(record.ListingId);
  const key = optionalText(record.ListingKey);
  return {
    id: key || listingId || `${source}-${index}`,
    listingId,
    address: listingAddress(record) || "Address withheld by listing feed",
    city: optionalText(record.City),
    region: optionalText(record.StateOrProvince),
    postalCode: optionalText(record.PostalCode),
    listPrice: optionalNumber(record.ListPrice),
    bedrooms: optionalNumber(record.BedroomsTotal),
    bathrooms: optionalNumber(record.BathroomsTotalInteger ?? record.BathroomsTotalDecimal),
    propertyType: optionalText(record.PropertySubType) || optionalText(record.PropertyType),
    latitude: optionalNumber(record.Latitude),
    longitude: optionalNumber(record.Longitude),
    modifiedAt: optionalText(record.ModificationTimestamp) || null,
    source,
  };
}

function escapeOData(value: string): string {
  return value.replaceAll("'", "''").toLowerCase();
}

export class ResoListingProvider {
  readonly board: ListingBoard;
  readonly label: string;
  private readonly propertyUrl: string;
  private readonly accessToken: string;
  private readonly fetchImpl: FetchLike;

  constructor(config: ResoConfig) {
    this.board = config.board;
    this.label = config.label;
    this.propertyUrl = config.propertyUrl;
    this.accessToken = config.accessToken;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.propertyUrl && this.accessToken);
  }

  async search(input: { query?: string; limit?: number } = {}): Promise<ListingSearchResult> {
    if (!this.isConfigured()) {
      throw new Error(`${this.label} is selected, but its server-side RESO credentials are not configured.`);
    }

    const url = new URL(this.propertyUrl);
    if (url.protocol !== "https:") {
      throw new Error("The RESO Property endpoint must use HTTPS.");
    }

    const limit = Math.max(1, Math.min(50, Math.floor(input.limit ?? 20)));
    const query = input.query?.trim();
    let filter = "StandardStatus eq 'Active'";
    if (query) {
      const escaped = escapeOData(query);
      filter += ` and (contains(tolower(UnparsedAddress),'${escaped}') or contains(tolower(City),'${escaped}') or contains(tolower(PostalCode),'${escaped}'))`;
    }

    url.searchParams.set("$filter", filter);
    url.searchParams.set("$top", String(limit));
    url.searchParams.set("$orderby", "ModificationTimestamp desc");
    url.searchParams.set(
      "$select",
      [
        "ListingKey", "ListingId", "UnparsedAddress", "StreetNumber", "StreetDirPrefix",
        "StreetName", "StreetSuffix", "UnitNumber", "City", "StateOrProvince",
        "PostalCode", "ListPrice", "BedroomsTotal", "BathroomsTotalInteger",
        "BathroomsTotalDecimal", "PropertyType", "PropertySubType", "Latitude",
        "Longitude", "ModificationTimestamp", "StandardStatus",
      ].join(","),
    );

    const response = await this.fetchImpl(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`${this.label} RESO request failed (${response.status})${detail ? `: ${detail}` : "."}`);
    }

    const payload = (await response.json()) as { value?: unknown };
    const records = Array.isArray(payload.value) ? payload.value.filter((item): item is ResoRecord => Boolean(item) && typeof item === "object") : [];
    const retrievedAt = new Date().toISOString();
    return {
      board: this.board,
      source: `${this.label} licensed RESO Web API`,
      retrievedAt,
      listings: records.map((record, index) => mapListing(record, this.label, index)),
    };
  }
}

export function createListingProvider(board: ListingBoard): ResoListingProvider {
  return new ResoListingProvider(envConfig(board));
}

