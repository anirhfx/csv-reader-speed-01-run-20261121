// A faster drop-in for csv-reader 1.0.0 (make.fun's own reference program).
// run(input) returns exactly csv-reader's answer {columns, rows, errors} for
// every input {text, header}, following its written broken-row policy:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside a quoted field a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it one quote, each CRLF or lone CR inside it read as LF; what
//     follows its closing quote, up to the next comma or line break, is appended
//     as it stands (quote_junk, when the field ends); a quote that never closes
//     is a literal character, and the text after it is read again as unquoted
//     (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it (every record when header is false), each padded with ""
//     (short_row, with fields: its field count) or cut (long_row, with extra:
//     the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met, a record's short_row or
//     long_row when it ends: line the 1-based line its record starts on,
//     counting every LF, CRLF and lone CR inside quotes, and row its record's
//     index in rows, null for the header.
//
// Speed comes from never reading the text one character at a time: a record
// whose line holds no quote is taken whole (one slice split on commas), an
// unquoted field ends at the next comma or at the record's line end, both
// found with indexOf, and a quoted field whose run holds no line break is one
// slice with its doubled quotes undone in a single replaceAll. Only a quoted
// field holding a line break falls back to a scan that jumps from one
// interesting character to the next. Field readers return the string alone and
// report how the field ended in one shared variable, so no object is built
// per field.

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const COMMA = 'comma';
const LINE_BREAK = 'line break';
const END = 'end';

/** The next quote, CR or LF: what matters inside a quoted field that holds a line break. */
const QUOTED_END = /["\r\n]/g;

/** csv-reader 1.0.0's answer for one case's input, {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // How the last field read ended, and the index of the next LF at or after pos (n when there is none).
  // lineEnd stays true across the comma-ended fields of one line; a quoted field that consumed line breaks
  // refreshes it before any later field is read.
  let ended = END;
  let lineEnd = n;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break, and returns the field. A CR
  // before the comma is always stray (a CRLF's LF would end the field first), and a CR before the line break
  // is the CRLF's own except for any earlier ones. The stray-CR check runs on the field's own slice, so it
  // never scans past the field.
  function readUnquoted(value) {
    const comma = text.indexOf(',', pos);
    if (comma !== -1 && comma < lineEnd) {
      const seg = text.slice(pos, comma);
      if (seg.indexOf('\r') === -1) {
        value += seg;
      } else {
        const clean = seg.replaceAll('\r', '');
        const strays = seg.length - clean.length;
        for (let k = 0; k < strays; k++) error('stray_cr');
        value += clean;
      }
      pos = comma + 1;
      ended = COMMA;
      return value;
    }
    if (lineEnd < n) {
      let end = lineEnd;
      if (end > pos && text.charCodeAt(end - 1) === 13) end -= 1;
      const seg = text.slice(pos, end);
      if (seg.indexOf('\r') === -1) {
        value += seg;
      } else {
        const clean = seg.replaceAll('\r', '');
        const strays = seg.length - clean.length;
        for (let k = 0; k < strays; k++) error('stray_cr');
        value += clean;
      }
      pos = lineEnd + 1;
      line += 1;
      ended = LINE_BREAK;
      return value;
    }
    const seg = text.slice(pos);
    if (seg.indexOf('\r') === -1) {
      value += seg;
    } else {
      const clean = seg.replaceAll('\r', '');
      const strays = seg.length - clean.length;
      for (let k = 0; k < strays; k++) error('stray_cr');
      value += clean;
    }
    pos = n;
    ended = END;
    return value;
  }

  // Reads a quoted field whose opening quote is at `open`, when its run holds a line break: CRLF and a lone CR
  // inside it are each one LF. Returns the field.
  function readQuotedSlow(open, openLine) {
    let value = '';
    pos = open + 1;
    line = openLine;
    for (;;) {
      QUOTED_END.lastIndex = pos;
      const m = QUOTED_END.exec(text);
      if (m === null) {
        // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      const i = m.index;
      if (i > pos) value += text.slice(pos, i);
      const c = text.charCodeAt(i);
      if (c === 34) {
        if (i + 1 < n && text.charCodeAt(i + 1) === 34) {
          value += '"';
          pos = i + 2;
          continue;
        }
        pos = i + 1;
        // The field spanned lines: the line end moved, so refresh it before anything else reads a field.
        if (line !== openLine) {
          const nl = text.indexOf('\n', pos);
          lineEnd = nl === -1 ? n : nl;
        }
        if (pos >= n) {
          ended = END;
          return value;
        }
        const d = text.charCodeAt(pos);
        if (d === 44) {
          pos += 1;
          ended = COMMA;
          return value;
        }
        if (d === 10) {
          pos += 1;
          line += 1;
          ended = LINE_BREAK;
          return value;
        }
        if (d === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
          pos += 2;
          line += 1;
          ended = LINE_BREAK;
          return value;
        }
        // What follows the closing quote is appended as it stands, up to the next comma or line break.
        const junk = readUnquoted(value);
        if (junk.length > value.length) error('quote_junk');
        return junk;
      }
      // CRLF and a lone CR inside quotes are each one LF.
      value += '\n';
      line += 1;
      if (c === 13) {
        pos = i + 1 < n && text.charCodeAt(i + 1) === 10 ? i + 2 : i + 1;
      } else {
        pos = i + 1;
      }
    }
  }

  // Reads a quoted field whose opening quote is at pos. Returns the field.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // The closing quote is the next quote that is not doubled.
    let close = text.indexOf('"', open + 1);
    while (close !== -1 && close + 1 < n && text.charCodeAt(close + 1) === 34) {
      close = text.indexOf('"', close + 2);
    }
    if (close === -1) {
      // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      error('unterminated_quote');
      return readUnquoted('"');
    }
    // A line break inside the run needs the slow scan (line counting, CR read as LF). The check runs on the
    // run's own slice, so it never scans past the closing quote.
    const run = text.slice(open + 1, close);
    if (run.indexOf('\r') !== -1 || run.indexOf('\n') !== -1) return readQuotedSlow(open, openLine);
    // The run is one slice; "" inside it is one quote.
    let value = run;
    if (value.indexOf('""') !== -1) value = value.replaceAll('""', '"');
    pos = close + 1;
    if (pos >= n) {
      ended = END;
      return value;
    }
    const d = text.charCodeAt(pos);
    if (d === 44) {
      pos += 1;
      ended = COMMA;
      return value;
    }
    if (d === 10) {
      pos += 1;
      line += 1;
      ended = LINE_BREAK;
      return value;
    }
    if (d === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      ended = LINE_BREAK;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the next comma or line break.
    const junk = readUnquoted(value);
    if (junk.length > value.length) error('quote_junk');
    return junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // The fast path: the record ends at the next LF, and when its line holds no quote every field in it is
    // unquoted, so the whole line is one slice split on commas. A lone CR in it is a stray one (the CRLF at
    // its end, if any, is taken off first): dropped, one stray_cr error each.
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? n : nl;
    lineEnd = end;
    let segEnd = end;
    if (nl !== -1 && end > pos && text.charCodeAt(end - 1) === 13) segEnd = end - 1;
    // A quote in this line means a quoted field (or a quote inside an unquoted one): the slow path. The scan
    // stops at the next quote, which is in this line or a line or two on; no slice is built for such a line.
    const q = text.indexOf('"', pos);
    let fields;
    let quoted = false;
    if (q === -1 || q >= segEnd) {
      const seg = text.slice(pos, segEnd);
      const r = seg.indexOf('\r');
      if (r === -1) {
        fields = seg.split(',');
      } else {
        const clean = seg.replaceAll('\r', '');
        const strays = seg.length - clean.length;
        for (let k = 0; k < strays; k++) error('stray_cr');
        fields = clean.split(',');
      }
      pos = nl === -1 ? n : nl + 1;
      if (nl !== -1) line += 1;
    } else {
      // The slow path: at least one field in this record is quoted, or holds a quote.
      fields = [];
      let value;
      do {
        quoted = text.charCodeAt(pos) === 34;
        value = quoted ? readQuoted() : readUnquoted('');
        fields.push(value);
      } while (ended === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
