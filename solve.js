// A fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Returns exactly what csv-reader's readCsv returns for {text, header}:
// {columns, rows, errors}. The text is read once, left to right.
// A U+FEFF at the very start is dropped. A record ends at LF or CRLF,
// and a line left with no characters is no record. Outside quotes a CR
// not followed by LF is dropped (error stray_cr). A field that opens
// with a quote runs to the next quote that is not doubled, "" inside it
// one quote and each CRLF or lone CR inside it read as LF; what follows
// its closing quote, up to the next comma or line break, is appended as
// it stands (quote_junk, when the field ends); a quote that never closes
// is a literal character, and the text after it is read again as
// unquoted (unterminated_quote). A quote inside an unquoted field is a
// literal character. Fields stay strings, never trimmed or converted.
// columns is the first record when header is true, else null; rows holds
// the records after it, each padded with "" (short_row) or cut (long_row)
// to the first record's width. Each error is {code, line, row}, in the
// order met, line the 1-based line its record starts on.
//
// Speed: the reference walks one character at a time and builds every
// field by concatenation. This reader instead jumps between delimiters
// with native indexOf scans and slices whole fields at once, so the
// common case (plain unquoted fields) costs a few native scans per
// field and no per-character JavaScript at all.

// How a field ended: at a comma, at a line break, or at the end.
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  // The record being read: the line it starts on and its index in rows
  // (null for the header). Errors raised while reading it use these.
  let recordLine = 1;
  let recordRow = null;

  // Field results travel in these instead of a fresh object per field:
  // a case holds well over a hundred thousand fields, and allocating
  // one answer object for each of them costs more than parsing it.
  let fValue = '';
  let fEnded = END;
  let fAdded = 0;
  let sText = '';
  let sLines = 0;

  // Reads unquoted characters onto `value` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Sets fValue,
  // fEnded and fAdded (how many characters were kept).
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      const comma = text.indexOf(',', pos);
      const lf = text.indexOf('\n', pos);
      let end;
      let kind;
      if (comma === -1 && lf === -1) {
        end = n;
        kind = END;
      } else if (lf === -1 || (comma !== -1 && comma < lf)) {
        end = comma;
        kind = COMMA;
      } else {
        end = lf;
        kind = LINE_BREAK;
      }
      const seg = text.slice(pos, end);
      const cr = seg.indexOf('\r');
      if (cr === -1) {
        value += seg;
        added += seg.length;
        if (kind === COMMA) {
          pos = end + 1;
          fValue = value;
          fEnded = COMMA;
          fAdded = added;
          return;
        }
        if (kind === LINE_BREAK) {
          pos = end + 1;
          line += 1;
          fValue = value;
          fEnded = LINE_BREAK;
          fAdded = added;
          return;
        }
        pos = n;
        fValue = value;
        fEnded = END;
        fAdded = added;
        return;
      }
      // The segment holds CRs. A lone CR at its very end, right before
      // the LF that ends it, is the CRLF ending, not a stray CR.
      const crlfTail = kind === LINE_BREAK && cr === seg.length - 1;
      if (crlfTail) {
        value += seg.slice(0, -1);
        added += seg.length - 1;
        pos = end + 1;
        line += 1;
        fValue = value;
        fEnded = LINE_BREAK;
        fAdded = added;
        return;
      }
      // Slow lane: drop each stray CR, one error apiece, and keep going.
      const limit = kind === LINE_BREAK && seg.charCodeAt(seg.length - 1) === 13
        ? seg.length - 1
        : seg.length;
      let from = 0;
      for (let i = 0; i < limit; i++) {
        if (seg.charCodeAt(i) === 13) {
          value += seg.slice(from, i);
          added += i - from;
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          from = i + 1;
        }
      }
      value += seg.slice(from, limit);
      added += limit - from;
      if (kind === COMMA) {
        pos = end + 1;
        fValue = value;
        fEnded = COMMA;
        fAdded = added;
        return;
      }
      if (kind === LINE_BREAK) {
        pos = end + 1;
        line += 1;
        fValue = value;
        fEnded = LINE_BREAK;
        fAdded = added;
        return;
      }
      pos = n;
      fValue = value;
      fEnded = END;
      fAdded = added;
      return;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Sets fValue
  // and fEnded (fAdded only matters on the junk lane, see below).
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let scan = pos + 1;
    // Lines counted inside the quotes; only committed once the field
    // is known to close, so an unterminated quote leaves `line` alone.
    let innerLines = 0;
    for (;;) {
      const q = text.indexOf('"', scan);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the
        // text after it is read again as unquoted.
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        pos = open + 1;
        line = openLine;
        readUnquoted('"');
        return;
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote in the value, scan on.
        convertSegment(scan, q);
        value += sText;
        innerLines += sLines;
        value += '"';
        scan = q + 2;
        continue;
      }
      convertSegment(scan, q);
      value += sText;
      innerLines += sLines;
      pos = q + 1;
      line += innerLines;
      if (pos >= n) {
        fValue = value;
        fEnded = END;
        return;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        fValue = value;
        fEnded = COMMA;
        return;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        fValue = value;
        fEnded = LINE_BREAK;
        return;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        fValue = value;
        fEnded = LINE_BREAK;
        return;
      }
      // What follows the closing quote is appended as it stands, up to
      // the next comma or line break.
      readUnquoted(value);
      if (fAdded > 0) {
        errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      }
      return;
    }
  }

  // A slice of a quoted field, [from, to): CRLF and lone CR inside it
  // each read as one LF, and the line breaks inside it counted. Sets
  // sText and sLines. The slice bounds the search, so a file with no
  // line breaks inside its quotes never scans past the field.
  function convertSegment(from, to) {
    if (from >= to) {
      sText = '';
      sLines = 0;
      return;
    }
    const raw = text.slice(from, to);
    if (raw.indexOf('\r') === -1 && raw.indexOf('\n') === -1) {
      sText = raw;
      sLines = 0;
      return;
    }
    let lines = 0;
    for (let i = 0; i < raw.length; i++) {
      const c = raw.charCodeAt(i);
      if (c === 10) {
        lines += 1;
      } else if (c === 13) {
        lines += 1;
        if (raw.charCodeAt(i + 1) === 10) i += 1;
      }
    }
    sText = raw.replace(/\r\n?/g, '\n');
    sLines = lines;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    let fields;
    let quoted = false;

    // Fast path: slice the line first, so every check on it is bounded
    // by its own length. A line that holds no quote and no stray CR is
    // just comma-separated fields, split natively instead of walked
    // field by field. A CR is allowed only as the CRLF ending's first
    // half, right before the line's LF.
    const lf = text.indexOf('\n', pos);
    const lineEnd = lf === -1 ? n : lf;
    let raw = text.slice(pos, lineEnd);
    if (lf !== -1 && raw.charCodeAt(raw.length - 1) === 13) raw = raw.slice(0, -1);
    if (raw.indexOf('"') === -1 && raw.indexOf('\r') === -1) {
      fields = raw.split(',');
      pos = lf === -1 ? n : lf + 1;
      if (lf !== -1) line += 1;
    } else {
      // Slow path: quoted fields, stray CRs, or junk after a quote.
      fields = [];
      do {
        quoted = text.charCodeAt(pos) === 34;
        if (quoted) readQuoted();
        else readUnquoted('');
        fields.push(fValue);
      } while (fEnded === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
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
