import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isLegacySpreadsheetFile, parseWorksheet, rowsToCsv, isSpreadsheetFile, xlsxToRows } from "../lib/xlsx.ts";
import { parseLeadCsv } from "../lib/briefing.ts";

test("recognises spreadsheet uploads by name or mime type", () => {
  assert.equal(isSpreadsheetFile("Rosedale_Converts.xlsx"), true);
  assert.equal(isSpreadsheetFile("leads.XLS"), false);
  assert.equal(isLegacySpreadsheetFile("leads.XLS"), true);
  assert.equal(isSpreadsheetFile("leads.csv"), false);
  assert.equal(
    isSpreadsheetFile("export", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    true,
  );
  assert.equal(isLegacySpreadsheetFile("export", "application/vnd.ms-excel"), true);
});

test("reads inline strings, shared strings, numbers, and gaps", () => {
  const xml = `<worksheet><sheetData>
    <row r="1"><c r="A1" t="inlineStr"><is><t>address</t></is></c><c r="C1" t="inlineStr"><is><t>notes</t></is></c></row>
    <row r="2"><c r="A2" t="inlineStr"><is><t>12 Rosedale Ave</t></is></c><c r="B2" t="s"><v>0</v></c><c r="C2"><v>650000</v></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Tom &amp; Sons</t></is></c><c r="B3" s="1"/></row>
  </sheetData></worksheet>`;
  const rows = parseWorksheet(xml, ["Shared Owner"]);
  assert.equal(rows.length, 3);
  // A gap (no B1 cell) must keep later columns in their real position.
  assert.deepEqual(rows[0], ["address", "", "notes"]);
  assert.deepEqual(rows[1], ["12 Rosedale Ave", "Shared Owner", "650000"]);
  // Entities decode, and a self-closing empty cell is blank rather than dropped.
  assert.deepEqual(rows[2], ["Tom & Sons", ""]);
});

test("rowsToCsv escapes commas, quotes, and newlines", () => {
  const csv = rowsToCsv([["a", "b,c"], ['say "hi"', "line\nbreak"]]);
  const [first, ...rest] = csv.split("\r\n");
  assert.equal(first, 'a,"b,c"');
  assert.equal(rest.join("\r\n"), '"say ""hi""","line\nbreak"');
});

test("reads a real .xlsx end to end and feeds the CSV importer", async () => {
  const buf = await readFile(new URL("./fixtures/sample.xlsx", import.meta.url));
  const rows = await xlsxToRows(buf);

  assert.deepEqual(rows[0], ["address", "owner_name", "notes", "assessed_value"]);
  assert.equal(rows[1][0], "12 Rosedale Ave");
  assert.equal(rows[1][1], "Shared Owner", "shared-string cells resolve through the string table");
  assert.equal(rows[1][2], "Inherited & may sell");
  assert.equal(rows[1][3], "650000");

  // The converted sheet flows through the same importer a CSV uses.
  const { leads } = parseLeadCsv(rowsToCsv(rows));
  assert.equal(leads.length, 2);
  assert.equal(leads[0].address, "12 Rosedale Ave");
  assert.equal(leads[0].ownerName, "Shared Owner");
  assert.match(leads[0].notes, /Inherited & may sell/);
  // Unmapped spreadsheet columns reach the agent as labeled context.
  assert.match(leads[0].notes, /assessed_value: 650000/);
});
