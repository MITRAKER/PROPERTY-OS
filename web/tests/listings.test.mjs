import assert from "node:assert/strict";
import test from "node:test";
import {
  ResoListingProvider,
  isListingBoard,
} from "../lib/listings/provider.ts";

test("only supported licensed boards are accepted", () => {
  assert.equal(isListingBoard("rebny_rls"), true);
  assert.equal(isListingBoard("trreb"), true);
  assert.equal(isListingBoard("generic_mls"), false);
  assert.equal(isListingBoard(""), false);
});

test("licensed RESO provider requests active records and maps evidence-backed results", async () => {
  const calls = [];
  const provider = new ResoListingProvider({
    board: "rebny_rls",
    label: "REBNY RLS",
    propertyUrl: "https://reso.example.test/Property",
    accessToken: "server-secret",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({
        value: [{
          ListingKey: "key-1",
          ListingId: "RLS-100",
          UnparsedAddress: "123 Main Street #4A",
          City: "New York",
          StateOrProvince: "NY",
          PostalCode: "10001",
          ListPrice: 1250000,
          BedroomsTotal: 2,
          BathroomsTotalInteger: 2,
          PropertySubType: "Condominium",
          Latitude: 40.75,
          Longitude: -73.99,
          ModificationTimestamp: "2026-07-24T12:00:00Z",
        }],
      });
    },
  });

  const result = await provider.search({ query: "O'Neil", limit: 200 });
  assert.equal(calls.length, 1);
  const requestUrl = new URL(calls[0].url);
  assert.match(requestUrl.searchParams.get("$filter") ?? "", /StandardStatus eq 'Active'/);
  assert.match(requestUrl.searchParams.get("$filter") ?? "", /o''neil/);
  assert.equal(requestUrl.searchParams.get("$top"), "50", "the provider caps the result size");
  assert.equal(calls[0].init.headers.Authorization, "Bearer server-secret");
  assert.equal(result.source, "REBNY RLS licensed RESO Web API");
  assert.deepEqual(result.listings[0], {
    id: "key-1",
    listingId: "RLS-100",
    address: "123 Main Street #4A",
    city: "New York",
    region: "NY",
    postalCode: "10001",
    listPrice: 1250000,
    bedrooms: 2,
    bathrooms: 2,
    propertyType: "Condominium",
    latitude: 40.75,
    longitude: -73.99,
    modifiedAt: "2026-07-24T12:00:00Z",
    source: "REBNY RLS",
  });
});

test("licensed provider never calls the network without server credentials", async () => {
  let called = false;
  const provider = new ResoListingProvider({
    board: "trreb",
    label: "TRREB",
    propertyUrl: "",
    accessToken: "",
    fetchImpl: async () => {
      called = true;
      return Response.json({});
    },
  });

  await assert.rejects(() => provider.search(), /server-side RESO credentials are not configured/);
  assert.equal(called, false);
});

test("licensed provider refuses non-HTTPS endpoints", async () => {
  const provider = new ResoListingProvider({
    board: "trreb",
    label: "TRREB",
    propertyUrl: "http://insecure.example.test/Property",
    accessToken: "secret",
    fetchImpl: async () => Response.json({ value: [] }),
  });
  await assert.rejects(() => provider.search(), /must use HTTPS/);
});

