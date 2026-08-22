/**
 * A small, correct RFC 4180 CSV parser.
 *
 * Hand-rolled rather than a dependency: the one thing that actually matters here is handling
 * quoted fields that contain embedded commas and newlines (a raindrop.io export has both), and
 * a naive `.split('\n')` / `.split(',')` silently produces the wrong row count and shifted
 * columns on exactly those rows. This implements the real state machine instead.
 */

/** Parses CSV text into an array of row-arrays. Handles quoted fields, "" escaping, and
 * embedded commas/newlines inside quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  // Normalize line endings up front so \r\n inside quoted fields doesn't need special-casing.
  const input = text.replace(/\r\n/g, '\n');

  while (i < input.length) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === ',') {
      endField();
      i++;
      continue;
    }
    if (char === '\n') {
      endRow();
      i++;
      continue;
    }
    field += char;
    i++;
  }

  // Trailing field/row, unless the file ended cleanly on a newline.
  if (field !== '' || row.length > 0) endRow();

  return rows;
}

/** Parses CSV text into an array of objects keyed by the header row. */
export function parseCsvRecords(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];

  const [header, ...body] = rows;
  return body
    .filter((row) => row.some((cell) => cell !== ''))
    .map((row) => Object.fromEntries(header.map((key, i) => [key, row[i] ?? ''])));
}
