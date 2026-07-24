// Minimal, dependency-free .xlsx reader.
//
// A spreadsheet is a ZIP of XML. This unzips it with the platform's built-in
// DecompressionStream (browser, Workers, and Node 18+ all ship it — no library)
// and reads the first worksheet into rows, so the importer can treat an Excel
// upload exactly like a CSV. It handles inline strings, the shared-string table,
// and plain numbers, which covers what Excel and the common exporters produce.

type ZipEntry = { method: number; compressedSize: number; offset: number };

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  // Copy into a stand-alone buffer: subarray views can be backed by a shared
  // buffer, which the stream writer will not accept.
  const chunk = new Uint8Array(bytes.byteLength);
  chunk.set(bytes);
  void writer.write(chunk);
  void writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// Read the central directory so we can locate entries by name.
function readCentralDirectory(buf: Uint8Array): Map<string, ZipEntry> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (dv.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That file is not a valid Excel workbook.");

  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count && p + 46 <= buf.length; n += 1) {
    if (dv.getUint32(p, true) !== SIG_CENTRAL) break;
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const name = decoder.decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, compressedSize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(buf: Uint8Array, entry: ZipEntry): Promise<string> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(entry.offset, true) !== SIG_LOCAL) throw new Error("The Excel file is corrupt.");
  const nameLen = dv.getUint16(entry.offset + 26, true);
  const extraLen = dv.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + entry.compressedSize);
  const bytes = entry.method === 0 ? data : await inflateRaw(data);
  return new TextDecoder().decode(bytes);
}

function unescapeXml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (whole, code: string) => {
    switch (code) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default:
        if (code[0] === "#") {
          const point = code[1] === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
          return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
        }
        return whole;
    }
  });
}

// Concatenate every <t> run inside a fragment (handles rich-text <r><t> too).
function textRuns(fragment: string): string {
  let out = "";
  const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fragment))) out += unescapeXml(m[1]);
  return out;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(textRuns(m[1]));
  return out;
}

// "A1" / "AB12" -> zero-based column index.
function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function parseWorksheet(xml: string, shared: string[] = []): string[][] {
  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  const cellRe = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRe.exec(xml))) {
    const cells: string[] = [];
    let auto = 0;
    let cellMatch: RegExpExecArray | null;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = cellMatch[1] ?? cellMatch[2] ?? "";
      const body = cellMatch[3] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "n";
      const col = ref ? columnIndex(ref) : auto;
      auto = col + 1;

      let value = "";
      if (type === "inlineStr") {
        value = textRuns(body);
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const decoded = raw !== undefined ? unescapeXml(raw) : "";
        value = type === "s" ? (shared[Number(decoded)] ?? "") : decoded;
      }
      cells[col] = value;
    }
    for (let i = 0; i < cells.length; i += 1) if (cells[i] === undefined) cells[i] = "";
    rows.push(cells);
  }
  return rows;
}

function firstWorksheetName(entries: Map<string, ZipEntry>): string {
  if (entries.has("xl/worksheets/sheet1.xml")) return "xl/worksheets/sheet1.xml";
  const sheets = [...entries.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort();
  if (sheets.length === 0) throw new Error("That workbook has no worksheets to import.");
  return sheets[0];
}

// Read the first worksheet of an .xlsx into rows of cell text.
export async function xlsxToRows(input: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const entries = readCentralDirectory(buf);

  const sharedEntry = entries.get("xl/sharedStrings.xml");
  const shared = sharedEntry ? parseSharedStrings(await readEntry(buf, sharedEntry)) : [];

  const sheetEntry = entries.get(firstWorksheetName(entries));
  if (!sheetEntry) throw new Error("That workbook has no worksheets to import.");
  return parseWorksheet(await readEntry(buf, sheetEntry), shared);
}

// Rows -> CSV text, so an Excel upload can flow through the same importer a CSV does.
export function rowsToCsv(rows: string[][]): string {
  const escape = (value: string) => (/[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return rows.map((row) => row.map((cell) => escape(cell ?? "")).join(",")).join("\r\n");
}

export function isSpreadsheetFile(name: string, type = ""): boolean {
  return /\.xlsx?$/i.test(name) || type.includes("spreadsheetml") || type.includes("ms-excel");
}
