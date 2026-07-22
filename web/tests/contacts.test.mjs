import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSkipTraceCsv,
  csvEscape,
  formatPhone,
  normalizeContact,
  normalizeEmail,
  normalizePhone,
  parseSkipTraceCsv,
  splitOwnerName,
} from "../lib/contacts/contact-model.ts";
import {
  createContactDataProvider,
  harvestContacts,
  HttpSkipTraceProvider,
  parseMailingAddress,
} from "../lib/contacts/provider.ts";

test("phone numbers normalise to E.164 and reject junk", () => {
  assert.equal(normalizePhone("(718) 555-0142"), "+17185550142");
  assert.equal(normalizePhone("718.555.0142"), "+17185550142");
  assert.equal(normalizePhone("1-718-555-0142"), "+17185550142");
  assert.equal(normalizePhone("555-0142"), null);
  assert.equal(normalizePhone("not a phone"), null);
});

test("phones display in a readable format", () => {
  assert.equal(formatPhone("+17185550142"), "(718) 555-0142");
});

test("emails normalise and reject junk", () => {
  assert.equal(normalizeEmail("  Owner@Example.COM "), "owner@example.com");
  assert.equal(normalizeEmail("owner@example"), null);
  assert.equal(normalizeEmail("nope"), null);
});

test("normalizeContact detects which kind it was given", () => {
  assert.deepEqual(normalizeContact("owner@example.com"), { type: "email", value: "owner@example.com" });
  assert.deepEqual(normalizeContact("(718) 555-0142"), { type: "phone", value: "+17185550142" });
  assert.equal(normalizeContact("garbage"), null);
});

test("owner names split from both public-record formats", () => {
  assert.deepEqual(splitOwnerName("THOMAS-FRANCOIS, MARLENE"), { first: "MARLENE", last: "THOMAS-FRANCOIS" });
  assert.deepEqual(splitOwnerName("JOSE W. RICHARDS"), { first: "JOSE", last: "RICHARDS" });
  assert.deepEqual(splitOwnerName("BOULEVARD HOUSING CORP"), { first: "BOULEVARD", last: "CORP" });
  assert.deepEqual(splitOwnerName(""), { first: "", last: "" });
});

test("CSV escaping quotes commas and quotes", () => {
  assert.equal(csvEscape("plain"), "plain");
  assert.equal(csvEscape("SMITH, JOHN"), '"SMITH, JOHN"');
  assert.equal(csvEscape('He said "hi"'), '"He said ""hi"""');
});

test("skip-trace export carries the columns vendors expect", () => {
  const csv = buildSkipTraceCsv([
    { propertyId: "p1", address: "139-23 243 STREET", ownerName: "THOMAS-FRANCOIS, MARLENE", mailingAddress: "99 PARK AVE" },
  ]);
  const [header, row] = csv.split("\r\n");
  assert.match(header, /property_id,address,owner_name,owner_first_name,owner_last_name,mailing_address/);
  assert.match(row, /p1/);
  assert.match(row, /MARLENE/);
  assert.match(row, /THOMAS-FRANCOIS/);
  assert.match(row, /99 PARK AVE/);
});

test("import harvests any phone/email column and matches by property_id", () => {
  const csv = [
    "property_id,address,Phone 1,mobile_phone,Email,junk",
    'p1,139-23 243 STREET,(718) 555-0142,718-555-9999,owner@example.com,ignore',
  ].join("\n");
  const rows = parseSkipTraceCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].propertyId, "p1");
  const values = rows[0].contacts.map((c) => c.value);
  assert.ok(values.includes("+17185550142"));
  assert.ok(values.includes("+17185559999"));
  assert.ok(values.includes("owner@example.com"));
  // The junk column must not become a contact.
  assert.equal(rows[0].contacts.length, 3);
});

test("import skips rows with no usable contact and de-duplicates", () => {
  const csv = ["address,Phone,Phone2", "1 Test St,,", "2 Test St,(718) 555-0142,718-555-0142"].join("\n");
  const rows = parseSkipTraceCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].address, "2 Test St");
  assert.equal(rows[0].contacts.length, 1, "the same number twice counts once");
});

test("no vendor configured reports honestly instead of faking a result", async () => {
  const provider = createContactDataProvider("none");
  assert.equal(provider.isConfigured(), false);
  const result = await provider.lookup({ propertyId: "p1", address: "1 Test St", ownerName: "Owner" });
  assert.equal(result.status, "not_configured");
  assert.equal(result.contacts.length, 0);
  assert.match(result.detail, /cheapest/i);
});

test("mailing address splits into the parts vendors ask for", () => {
  assert.deepEqual(parseMailingAddress("99 PARK AVE, NEW YORK, NY 10016"), {
    street: "99 PARK AVE",
    city: "NEW YORK",
    state: "NY",
    zip: "10016",
  });
  assert.deepEqual(parseMailingAddress(""), { street: "", city: "", state: "", zip: "" });
});

test("harvestContacts deep-scans any JSON shape by key hint", () => {
  const payload = {
    data: {
      mobilePhone: "(718) 555-0142",
      homePhone: "718-555-0143",
      contact: { email: "OWNER@Example.com" },
      ssn: "123456789",
      recordId: 5551234567, // 10 digits but not phone-keyed — must be ignored
    },
  };
  const contacts = harvestContacts(payload, "testvendor");
  const values = contacts.map((c) => c.value);
  assert.ok(values.includes("+17185550142"));
  assert.ok(values.includes("+17185550143"));
  assert.ok(values.includes("owner@example.com"));
  assert.equal(contacts.length, 3, "the 10-digit recordId must not be harvested as a phone");
  const mobile = contacts.find((c) => c.value === "+17185550142");
  assert.equal(mobile.label, "mobile");
  assert.equal(mobile.source, "testvendor");
});

function fakeFetch(response) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  return { impl, calls };
}

test("HttpSkipTraceProvider maps a live response into contacts", async () => {
  const payload = {
    results: {
      persons: [
        { phoneNumbers: [{ number: "7185550142", type: "Mobile" }], emails: [{ email: "owner@example.com" }] },
      ],
    },
  };
  const { impl, calls } = fakeFetch({ ok: true, status: 200, json: async () => payload });
  const provider = new HttpSkipTraceProvider({
    name: "batchdata",
    url: "https://api.example.com/skip",
    key: "secret-key",
    authHeader: "Authorization",
    authScheme: "Bearer",
    bodyStyle: "batchdata",
    fetchImpl: impl,
  });
  assert.equal(provider.isConfigured(), true);
  const result = await provider.lookup({
    propertyId: "p1",
    address: "139-23 243 St",
    ownerName: "THOMAS-FRANCOIS, MARLENE",
    mailingAddress: "99 PARK AVE, NEW YORK, NY 10016",
  });
  assert.equal(result.status, "found");
  assert.equal(result.provider, "batchdata");
  const values = result.contacts.map((c) => c.value);
  assert.ok(values.includes("+17185550142"));
  assert.ok(values.includes("owner@example.com"));
  // The key travels in the Authorization header, and the owner name is sent.
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret-key");
  assert.match(calls[0].init.body, /THOMAS-FRANCOIS/);
});

test("HttpSkipTraceProvider reports not_found, failed, and not_configured", async () => {
  const empty = fakeFetch({ ok: true, status: 200, json: async () => ({ persons: [] }) });
  const found = new HttpSkipTraceProvider({ name: "v", url: "https://x", key: "k", authHeader: "Authorization", authScheme: "Bearer", bodyStyle: "flat", fetchImpl: empty.impl });
  assert.equal((await found.lookup({ propertyId: "p1", address: "a", ownerName: "O" })).status, "not_found");

  const errored = fakeFetch({ ok: false, status: 429, json: async () => ({}) });
  const failing = new HttpSkipTraceProvider({ name: "v", url: "https://x", key: "k", authHeader: "Authorization", authScheme: "Bearer", bodyStyle: "flat", fetchImpl: errored.impl });
  const failResult = await failing.lookup({ propertyId: "p1", address: "a", ownerName: "O" });
  assert.equal(failResult.status, "failed");
  assert.match(failResult.detail, /429/);

  // No key: must not even call fetch.
  const never = fakeFetch({ ok: true, status: 200, json: async () => ({}) });
  const unconfigured = new HttpSkipTraceProvider({ name: "v", url: "https://x", key: "", authHeader: "Authorization", authScheme: "Bearer", bodyStyle: "flat", fetchImpl: never.impl });
  assert.equal(unconfigured.isConfigured(), false);
  assert.equal((await unconfigured.lookup({ propertyId: "p1", address: "a", ownerName: "O" })).status, "not_configured");
  assert.equal(never.calls.length, 0, "an unconfigured provider must not make a network call");
});
