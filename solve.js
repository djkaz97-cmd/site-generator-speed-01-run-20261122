// solve.js — makefun-site 1.0.0's answer, computed faster.
//
// run(input) returns exactly what make.fun's makefun-site 1.0.0 returns for one site: the output tree, path ->
// text, byte for byte (each page's index.html, the index pages, the tag and tags pages, build-report.txt and
// every static file). makefun-site's rules are its own — front matter, template dialect, Markdown subset, slug
// rule and build report — and this module implements them directly instead of through a chain of regexes:
// one scan per Markdown body, one pass over inline text, slug and date caches, templates parsed once per case.
//
// MIT. Derived from make.fun's makefun-site 1.0.0 (MIT, itself derived from metalsmith 2.7.0 and marked 18.2.1);
// see LICENSE and NOTICE.

const SLUG_MAX = 64;
const RESERVED = ['posts', 'tags', 'page'];
const REPORT_FILE = 'build-report.txt';
const INCLUDE_DEPTH = 8;

/* ------------------------------------------------------------------- text */

const ESC_TEST = /[&<>"']/;
const ESC_ALL = /[&<>"']/g;

function escChar(c) {
  switch (c) {
    case '&': return '&amp;';
    case '<': return '&lt;';
    case '>': return '&gt;';
    case '"': return '&quot;';
    default: return '&#39;';
  }
}

/** `text` with & < > " and ' escaped, and nothing else. */
function escapeHtml(text) {
  return ESC_TEST.test(text) ? text.replace(ESC_ALL, escChar) : text;
}

/** Each escapable ASCII character's own text, for the inline scanner's `\x` escapes (">" escapes to `&gt;`). */
const ESC_BY_CODE = [];
for (const ch of ['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']) {
  ESC_BY_CODE[ch.charCodeAt(0)] = ch === '>' ? '&gt;' : ch;
}

const MARKS = /\p{M}/gu;
const slugCache = new Map();

/** The slug of `text` (README "Text"): NFKD, marks dropped, A-Z lowered, other runs one "-", cut at 64. */
function slugOf(text) {
  let plain = text;
  for (let i = 0; i < plain.length; i++) {
    if (plain.charCodeAt(i) > 127) {
      plain = plain.normalize('NFKD').replace(MARKS, '');
      break;
    }
  }
  let out = '';
  let gap = false;
  for (let i = 0; i < plain.length; i++) {
    const c = plain.charCodeAt(i);
    let keep = 0;
    if (c >= 65 && c <= 90) keep = c + 32;
    else if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) keep = c;
    if (keep === 0) {
      if (out.length > 0) gap = true;
      continue;
    }
    if (gap) {
      out += '-';
      gap = false;
    }
    out += String.fromCharCode(keep);
  }
  if (out.length > SLUG_MAX) out = out.slice(0, SLUG_MAX);
  if (out.length > 0 && out.charCodeAt(out.length - 1) === 45) out = out.replace(/-+$/, '');
  return out === '' ? 'untitled' : out;
}

function slugify(text) {
  const hit = slugCache.get(text);
  if (hit !== undefined) return hit;
  const out = slugOf(text);
  if (slugCache.size >= 40000) slugCache.clear();
  slugCache.set(text, out);
  return out;
}

/** `slug` made unique against `taken`, and added to it. */
function uniqueSlug(slug, taken) {
  if (!taken.has(slug)) {
    taken.add(slug);
    return slug;
  }
  let n = 2;
  let out = `${slug}-${n}`;
  while (taken.has(out)) {
    n++;
    out = `${slug}-${n}`;
  }
  taken.add(out);
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateCache = new Map();

/** A YYYY-MM-DD date in words: "2026-11-09" is "9 November 2026". */
function longDate(date) {
  const hit = dateCache.get(date);
  if (hit !== undefined) return hit;
  const a = date.indexOf('-');
  const b = date.indexOf('-', a + 1);
  const out = `${Number(date.slice(b + 1))} ${MONTHS[Number(date.slice(a + 1, b)) - 1]} ${date.slice(0, a)}`;
  if (dateCache.size >= 8000) dateCache.clear();
  dateCache.set(date, out);
  return out;
}

/** JavaScript's own whitespace set (what \s matches), as a code-unit table. */
const WS_TAB = new Uint8Array(65536);
for (const c of [9, 10, 11, 12, 13, 32, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]) WS_TAB[c] = 1;
for (let c = 0x2000; c <= 0x200a; c++) WS_TAB[c] = 1;

function isWsCode(c) {
  return c < 65536 && WS_TAB[c] === 1;
}

const HAS_WS = /\s/;

/** The words of a body: its runs of characters other than whitespace. */
function wordsOf(text) {
  let count = 0;
  let prevWs = 1;
  for (let i = 0; i < text.length; i++) {
    const ws = WS_TAB[text.charCodeAt(i)];
    count += (1 - ws) & prevWs;
    prevWs = ws;
  }
  return count;
}

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/* ------------------------------------------------------------- front matter */

const KEYS = new Set(['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary']);
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NAME_RE = /^[a-z0-9-]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TAG_RE = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

const QUOTED_CLOSED = 'a quoted string is not closed';

/** A string value: "..." with \" and \\ its only escapes, or bare. */
function stringOf(raw) {
  if (raw.charCodeAt(0) === 34) {
    if (raw.length < 2 || raw.charCodeAt(raw.length - 1) !== 34) return { error: QUOTED_CLOSED };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw.charCodeAt(i);
      if (c === 92) {
        const n = raw.charCodeAt(i + 1);
        if ((n !== 34 && n !== 92) || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += String.fromCharCode(n);
        i++;
      } else if (c === 34) return { error: 'a quoted string holds a stray quote' };
      else out += String.fromCharCode(c);
    }
    return { value: out };
  }
  if (raw.charCodeAt(0) === 91) return { error: 'a bare string opens on [' };
  return { value: raw };
}

/** One key's value, or why it is refused. */
function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return s.error !== undefined ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = DATE_RE.exec(raw);
      if (m === null) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) {
        return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      }
      return { value: raw };
    }
    case 'tags': {
      if (raw.charCodeAt(0) !== 91 || raw.charCodeAt(raw.length - 1) !== 93) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      for (const t of tags) if (t === '' || !TAG_RE.test(t)) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      if (raw === 'true') return { value: true };
      if (raw === 'false') return { value: false };
      return { error: 'key "draft": true or false' };
    case 'layout':
      return NAME_RE.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return SLUG_RE.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

function isBlankRange(src, a, e) {
  for (let i = a; i < e; i++) {
    const c = src.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** A source's front matter and body: { data, body }, or { error }. `text` has "\n" line ends. */
function parseFrontMatter(text) {
  const n = text.length;
  if (n < 3 || text.charCodeAt(0) !== 45 || text.charCodeAt(1) !== 45 || text.charCodeAt(2) !== 45 || (n > 3 && text.charCodeAt(3) !== 10)) {
    return { error: 'no front matter' };
  }
  if (n === 3) return { error: 'the front matter is not closed' };
  let closeStart = -1;
  let closeEnd = -1;
  let pos = 4;
  let lineNo = 1;
  while (pos <= n) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? n : nl;
    lineNo++;
    if (end - pos === 3 && text.charCodeAt(pos) === 45 && text.charCodeAt(pos + 1) === 45 && text.charCodeAt(pos + 2) === 45) {
      closeStart = pos;
      closeEnd = end;
      break;
    }
    if (end === n) break;
    pos = end + 1;
  }
  if (closeStart === -1) return { error: 'the front matter is not closed' };
  const data = {};
  pos = 4;
  let idx = 1;
  while (pos < closeStart) {
    const end = text.indexOf('\n', pos);
    idx++;
    let a = pos;
    const e = end;
    let skip = false;
    if (isBlankRange(text, a, e)) skip = true;
    else if (text.charCodeAt(a) === 35) skip = true;
    if (!skip) {
      // key: value — a key of a-z and _, one space after the colon, the value to the line's end
      let colon = a;
      while (colon < e && text.charCodeAt(colon) !== 58) colon++;
      let bad = colon === a || colon >= e;
      if (!bad) {
        for (let k = a; k < colon; k++) {
          const c = text.charCodeAt(k);
          if (!((c >= 97 && c <= 122) || c === 95)) {
            bad = true;
            break;
          }
        }
      }
      if (bad || (colon + 1 < e && text.charCodeAt(colon + 1) !== 32)) return { error: `line ${idx} is not "key: value"` };
      const key = text.slice(a, colon);
      let raw = colon + 1 >= e ? '' : text.slice(colon + 2, e);
      let re = raw.length;
      while (re > 0) {
        const c = raw.charCodeAt(re - 1);
        if (c !== 32 && c !== 9) break;
        re--;
      }
      if (re !== raw.length) raw = raw.slice(0, re);
      if (!KEYS.has(key)) return { error: `unknown key "${key}"` };
      if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
      if (raw === '') return { error: `key "${key}" has no value` };
      const v = valueOf(key, raw);
      if (v.error !== undefined) return v;
      data[key] = v.value;
    }
    pos = e + 1;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, body: closeEnd >= n ? '' : text.slice(closeEnd + 1) };
}

/* ----------------------------------------------------------------- Markdown */

const ESCAPABLE = new Uint8Array(128);
for (const ch of ['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']) ESCAPABLE[ch.charCodeAt(0)] = 1;

/** The first index from `from` where `what` (a code) sits outside a backslash escape, or -1. */
function findUnescaped(src, code, from) {
  const n = src.length;
  for (let j = from; j < n; j++) {
    const c = src.charCodeAt(j);
    if (c === 92) {
      if (j + 1 < n && ESCAPABLE[src.charCodeAt(j + 1)] === 1) j++;
      continue;
    }
    if (c === code) return j;
  }
  return -1;
}

/** The first index from `from` where "**" sits outside a backslash escape, or -1. */
function findDoubleStar(src, from) {
  const n = src.length;
  for (let j = from; j < n - 1; j++) {
    const c = src.charCodeAt(j);
    if (c === 92) {
      if (ESCAPABLE[src.charCodeAt(j + 1)] === 1) j++;
      continue;
    }
    if (c === 42 && src.charCodeAt(j + 1) === 42) return j;
  }
  return -1;
}

/** The first single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(src, from) {
  const n = src.length;
  for (let j = from; j < n; j++) {
    const c = src.charCodeAt(j);
    if (c === 92) {
      if (j + 1 < n && ESCAPABLE[src.charCodeAt(j + 1)] === 1) j++;
      continue;
    }
    if (c !== 42) continue;
    if (src.charCodeAt(j + 1) === 42) {
      j++;
      continue;
    }
    return j;
  }
  return -1;
}

/** The characters inline cares about: the Markdown openers and the five the HTML escape table touches. */
const SPECIAL_RE = /[\\`*\[&<>"']/g;

/** `src` rendered inline; `env.link(target)` is a link's href. */
function inline(src, env) {
  const n = src.length;
  let out = '';
  let plain = 0;
  let i = 0;
  while (i < n) {
    SPECIAL_RE.lastIndex = i;
    const found = SPECIAL_RE.exec(src);
    const j = found === null ? n : found.index;
    if (j >= n) {
      if (plain === 0) return src;
      out += src.slice(plain);
      return out;
    }
    if (j > plain) out += src.slice(plain, j);
    const c = src.charCodeAt(j);
    if (c === 92) {
      const x = j + 1 < n ? src.charCodeAt(j + 1) : -1;
      if (x >= 0 && x < 128 && ESCAPABLE[x] === 1) {
        out += ESC_BY_CODE[x];
        i = j + 2;
      } else {
        out += '\\';
        i = j + 1;
      }
      plain = i;
      continue;
    }
    if (c === 96) {
      const k = src.indexOf('`', j + 1);
      if (k > j + 1) {
        out += `<code>${escapeHtml(src.slice(j + 1, k))}</code>`;
        i = k + 1;
      } else {
        out += '`';
        i = j + 1;
      }
      plain = i;
      continue;
    }
    if (c === 42) {
      if (src.charCodeAt(j + 1) === 42) {
        const k = findDoubleStar(src, j + 2);
        if (k > j + 2) {
          out += `<strong>${inline(src.slice(j + 2, k), env)}</strong>`;
          i = k + 2;
        } else {
          out += '**';
          i = j + 2;
        }
      } else {
        const k = findSingleStar(src, j + 1);
        if (k > j + 1) {
          out += `<em>${inline(src.slice(j + 1, k), env)}</em>`;
          i = k + 1;
        } else {
          out += '*';
          i = j + 1;
        }
      }
      plain = i;
      continue;
    }
    if (c === 91) {
      const k = findUnescaped(src, 93, j + 1);
      if (k !== -1 && src.charCodeAt(k + 1) === 40) {
        const m = src.indexOf(')', k + 2);
        if (m !== -1) {
          const target = src.slice(k + 2, m);
          if (target !== '' && !HAS_WS.test(target)) {
            out += `<a href="${escapeHtml(env.link(target))}">${inline(src.slice(j + 1, k), env)}</a>`;
            i = m + 1;
            plain = i;
            continue;
          }
        }
      }
      out += '[';
      i = j + 1;
      plain = i;
      continue;
    }
    out += escChar(src[j]);
    i = j + 1;
    plain = i;
  }
  if (plain < n) out += src.slice(plain);
  return out;
}

/** The text of a heading line (its trailing spaces and tabs dropped), or null. */
function headingOf(src, a, e) {
  let k = a;
  while (k < e && src.charCodeAt(k) === 35) k++;
  const depth = k - a;
  if (depth < 1 || depth > 6 || k >= e) return null;
  const c = src.charCodeAt(k);
  if (c !== 32 && c !== 9) return null;
  while (k < e) {
    const d = src.charCodeAt(k);
    if (d !== 32 && d !== 9) break;
    k++;
  }
  let end = e;
  while (end > k) {
    const d = src.charCodeAt(end - 1);
    if (d !== 32 && d !== 9) break;
    end--;
  }
  return end <= k ? null : { depth, start: k, end };
}

function isHr(src, a, e) {
  if (e - a < 3) return false;
  const c = src.charCodeAt(a);
  if (c !== 45 && c !== 42) return false;
  if (src.charCodeAt(a + 1) !== c || src.charCodeAt(a + 2) !== c) return false;
  for (let k = a + 3; k < e; k++) {
    const d = src.charCodeAt(k);
    if (d !== 32 && d !== 9) return false;
  }
  return true;
}

function isFenceOpen(src, a, e) {
  if (e - a < 3 || src.charCodeAt(a) !== 96 || src.charCodeAt(a + 1) !== 96 || src.charCodeAt(a + 2) !== 96) return false;
  let k = a + 3;
  while (k < e) {
    const c = src.charCodeAt(k);
    if (c === 32 || c === 9) break;
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 43 || c === 45)) return false;
    k++;
  }
  for (; k < e; k++) {
    const c = src.charCodeAt(k);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

function isFenceClose(src, a, e) {
  if (e - a < 3 || src.charCodeAt(a) !== 96 || src.charCodeAt(a + 1) !== 96 || src.charCodeAt(a + 2) !== 96) return false;
  for (let k = a + 3; k < e; k++) {
    const c = src.charCodeAt(k);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

/** A bullet item's text start, or -1. */
function bulletStart(src, a, e) {
  if (e - a < 2) return -1;
  const c = src.charCodeAt(a);
  if ((c !== 45 && c !== 42) || src.charCodeAt(a + 1) !== 32) return -1;
  return a + 2;
}

/** An ordered item's text start, or -1 when the line is not one. */
function orderedStart(src, a, e) {
  let k = a;
  const max = Math.min(e, a + 9);
  while (k < max) {
    const c = src.charCodeAt(k);
    if (c < 48 || c > 57) break;
    k++;
  }
  if (k === a || k + 1 >= e) return -1;
  if (src.charCodeAt(k) !== 46 || src.charCodeAt(k + 1) !== 32) return -1;
  let num = 0;
  for (let j = a; j < k; j++) num = num * 10 + (src.charCodeAt(j) - 48);
  return { start: num, text: k + 2 };
}

/** A line of two or more spaces then a non-space continues a list item. */
function isContinued(src, a, e) {
  if (e - a < 3 || src.charCodeAt(a) !== 32 || src.charCodeAt(a + 1) !== 32) return false;
  let k = a + 2;
  while (k < e && src.charCodeAt(k) === 32) k++;
  return k < e && !isWsCode(src.charCodeAt(k));
}

function trimSlice(src, a, e) {
  while (a < e) {
    const c = src.charCodeAt(a);
    if (c !== 32 && c !== 9) break;
    a++;
  }
  while (e > a) {
    const c = src.charCodeAt(e - 1);
    if (c !== 32 && c !== 9) break;
    e--;
  }
  return src.slice(a, e);
}

/** Whether a line ends a paragraph: blank, a fence, a heading or a thematic break. */
function endsParagraph(src, a, e) {
  if (a >= e) return true;
  const c = src.charCodeAt(a);
  if (c === 32 || c === 9) return isBlankRange(src, a, e);
  if (c === 96) return isFenceOpen(src, a, e);
  if (c === 35) return headingOf(src, a, e) !== null;
  if (c === 45 || c === 42) return isHr(src, a, e);
  return false;
}

/** `src` rendered: { html, toc, excerpt }. */
function renderMarkdown(src, env) {
  const n = src.length;
  const parts = [];
  const toc = [];
  const ids = new Set();
  let excerpt = null;
  let i = 0;
  while (i <= n) {
    const nl = src.indexOf('\n', i);
    const e = nl === -1 ? n : nl;
    if (e > i) {
      const c = src.charCodeAt(i);
      if (c === 32 || c === 9) {
        if (isBlankRange(src, i, e)) {
          i = e + 1;
          continue;
        }
      } else if (c === 96 && isFenceOpen(src, i, e)) {
        let langEnd = i + 3;
        while (langEnd < e) {
          const d = src.charCodeAt(langEnd);
          if (d === 32 || d === 9) break;
          langEnd++;
        }
        const lang = langEnd === i + 3 ? '' : src.slice(i + 3, langEnd);
        let j = e === n ? n + 1 : e + 1;
        let body = '';
        while (j <= n) {
          const nl2 = src.indexOf('\n', j);
          const e2 = nl2 === -1 ? n : nl2;
          if (isFenceClose(src, j, e2)) {
            j = e2 === n ? n + 1 : e2 + 1;
            break;
          }
          body += `${escapeHtml(src.slice(j, e2))}\n`;
          j = e2 === n ? n + 1 : e2 + 1;
        }
        parts.push(lang === '' ? `<pre><code>${body}</code></pre>` : `<pre><code class="language-${lang}">${body}</code></pre>`);
        i = j;
        continue;
      } else if (c === 35) {
        const h = headingOf(src, i, e);
        if (h !== null) {
          const text = src.slice(h.start, h.end);
          const id = uniqueSlug(slugify(text), ids);
          const html = inline(text, env);
          parts.push(`<h${h.depth} id="${id}">${html}</h${h.depth}>`);
          if (h.depth === 2 || h.depth === 3) toc.push({ level: h.depth, id, html });
          i = e + 1;
          continue;
        }
      } else if ((c === 45 || c === 42) && isHr(src, i, e)) {
        parts.push('<hr>');
        i = e + 1;
        continue;
      } else if (c === 62) {
        const lines = [];
        let j = i;
        while (j <= n) {
          const nl2 = src.indexOf('\n', j);
          const e2 = nl2 === -1 ? n : nl2;
          if (src.charCodeAt(j) !== 62) break;
          let k = j + 1;
          if (k < e2 && src.charCodeAt(k) === 32) k++;
          const t = trimSlice(src, k, e2);
          if (t !== '') lines.push(t);
          j = e2 === n ? n + 1 : e2 + 1;
        }
        parts.push(lines.length === 0 ? '<blockquote>\n</blockquote>' : `<blockquote>\n<p>${inline(lines.join('\n'), env)}</p>\n</blockquote>`);
        i = j;
        continue;
      } else if (c === 45 || c === 42 || (c >= 48 && c <= 57)) {
        const bullet = bulletStart(src, i, e);
        const ordered = bullet === -1 ? orderedStart(src, i, e) : -1;
        if (bullet !== -1 || ordered !== -1) {
          const isOrdered = ordered !== -1;
          const items = [];
          let j = i;
          while (j <= n) {
            const nl2 = src.indexOf('\n', j);
            const e2 = nl2 === -1 ? n : nl2;
            const ts = isOrdered ? orderedStart(src, j, e2) : bulletStart(src, j, e2);
            if (ts !== -1) {
              items.push(trimSlice(src, isOrdered ? ts.text : ts, e2));
              j = e2 === n ? n + 1 : e2 + 1;
              continue;
            }
            if (isContinued(src, j, e2)) {
              items[items.length - 1] += `\n${trimSlice(src, j, e2)}`;
              j = e2 === n ? n + 1 : e2 + 1;
              continue;
            }
            break;
          }
          const tag = isOrdered ? 'ol' : 'ul';
          const open = isOrdered && ordered.start !== 1 ? `<ol start="${ordered.start}">` : `<${tag}>`;
          let lis = '';
          for (let k = 0; k < items.length; k++) lis += `<li>${inline(items[k], env)}</li>\n`;
          parts.push(`${open}\n${lis}</${tag}>`);
          i = j;
          continue;
        }
      }
      let text = trimSlice(src, i, e);
      let j = e === n ? n + 1 : e + 1;
      while (j <= n) {
        const nl2 = src.indexOf('\n', j);
        const e2 = nl2 === -1 ? n : nl2;
        if (endsParagraph(src, j, e2)) break;
        text += `\n${trimSlice(src, j, e2)}`;
        j = e2 === n ? n + 1 : e2 + 1;
      }
      const html = inline(text, env);
      if (excerpt === null) excerpt = html;
      parts.push(`<p>${html}</p>`);
      i = j;
      continue;
    }
    i = e + 1;
  }
  return { html: parts.length === 0 ? '' : `${parts.join('\n')}\n`, toc, excerpt: excerpt ?? '' };
}

/* ---------------------------------------------------------------- templates */

const PATH_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR_RE = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF_RE = /^if (not )?(\S+)$/;
const INCLUDE_RE = /^include "([a-z0-9-]+)"$/;

class TemplateError extends Error {}

function pathOf(name, text) {
  if (!PATH_RE.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

/** `src`'s tokens: text, {{ }}, {{{ }}} and {% %}, a standalone tag's line taken with it. */
function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === n - 1) {
      text += src.slice(i);
      break;
    }
    const next = src.charCodeAt(open + 1);
    if (next !== 123 && next !== 37) {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === 123) {
      const raw = src.charCodeAt(open + 2) === 123;
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? n : nl;
    const standalone = isBlankRange(src, lineStart, open) && isBlankRange(src, end, lineEnd);
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? n : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

/** `src` parsed into its tree of nodes (a TemplateError when it does not parse). */
function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR_RE.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF_RE.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE_RE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

/** The value at `path` in the scope chain: its first name from the nearest scope holding it, then own properties. */
function lookup(scope, path) {
  let s = scope;
  const first = path[0];
  while (s !== null && !Object.hasOwn(s.vars, first)) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[first];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

/** A value as text: a string itself, a number in JavaScript's digits, true or false, an array's items joined by ", ". */
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

/** Whether a value counts as true in an if. */
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

/** `nodes` rendered into `out` in `scope` ({ vars, parent }). `ctx` holds the parsed templates and the root-only cache. */
function renderInto(nodes, scope, ctx, depth, inLoop, out) {
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k];
    switch (n.kind) {
      case 'text':
        out.push(n.text);
        break;
      case 'var':
        out.push(escapeHtml(textOf(lookup(scope, n.path))));
        break;
      case 'raw':
        out.push(textOf(lookup(scope, n.path)));
        break;
      case 'if': {
        const branch = (truthy(lookup(scope, n.path)) !== n.not) ? n.then : n.else;
        if (branch !== null) renderInto(branch, scope, ctx, depth, inLoop, out);
        break;
      }
      case 'for': {
        const xs = lookup(scope, n.path);
        if (Array.isArray(xs)) {
          const len = xs.length;
          for (let j = 0; j < len; j++) {
            const vars = { [n.name]: xs[j], loop: { index: j + 1, first: j === 0, last: j === len - 1, length: len } };
            renderInto(n.body, { vars, parent: scope }, ctx, depth, true, out);
          }
        }
        break;
      }
      case 'include': {
        const t = ctx.templates.get(n.name);
        if (t !== undefined && depth < INCLUDE_DEPTH) {
          if (!inLoop && ctx.rootOnly.has(n.name)) {
            // Only site, tags and recent are read, and no loop shadows them: one render serves every page.
            const key = `${n.name}|${depth}`;
            let cached = ctx.rootCache.get(key);
            if (cached === undefined) {
              const sub = [];
              renderInto(t, scope, ctx, depth + 1, false, sub);
              cached = sub.join('');
              ctx.rootCache.set(key, cached);
            }
            out.push(cached);
          } else renderInto(t, scope, ctx, depth + 1, inLoop, out);
        }
        break;
      }
    }
  }
}

/* ------------------------------------------------------- template analysis */

/** The names a template reads from the scope around it, and where it includes another. */
function analyseNodes(nodes, bound, free, includes) {
  for (const n of nodes) {
    switch (n.kind) {
      case 'text':
        break;
      case 'var':
      case 'raw':
        if (!bound.has(n.path[0])) free.add(n.path[0]);
        break;
      case 'if':
        if (!bound.has(n.path[0])) free.add(n.path[0]);
        analyseNodes(n.then, bound, free, includes);
        if (n.else !== null) analyseNodes(n.else, bound, free, includes);
        break;
      case 'for': {
        if (!bound.has(n.path[0])) free.add(n.path[0]);
        const inner = new Set(bound);
        inner.add(n.name);
        analyseNodes(n.body, inner, free, includes);
        break;
      }
      case 'include':
        includes.push({ name: n.name, bound: new Set(bound) });
        break;
    }
  }
}

/** The templates whose output depends on `site`, `tags` and `recent` alone (and on nothing a loop can shadow). */
function rootOnlyTemplates(templates) {
  const infos = new Map();
  for (const [name, nodes] of templates) {
    const free = new Set();
    const includes = [];
    analyseNodes(nodes, new Set(), free, includes);
    infos.set(name, { free, includes });
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [, info] of infos) {
      for (const inc of info.includes) {
        const target = infos.get(inc.name);
        if (target === undefined) continue;
        for (const name of target.free) {
          if (!inc.bound.has(name) && !info.free.has(name)) {
            info.free.add(name);
            changed = true;
          }
        }
      }
    }
  }
  const out = new Set();
  for (const [name, info] of infos) {
    let rootOnly = true;
    for (const n of info.free) {
      if (n !== 'site' && n !== 'tags' && n !== 'recent') {
        rootOnly = false;
        break;
      }
    }
    if (rootOnly) out.add(name);
  }
  return out;
}

/* -------------------------------------------------------------------- build */

export function run(input) {
  const templates = new Map();
  const report = [];
  const names = Object.keys(input.templates).sort(byCodeUnits);
  for (let k = 0; k < names.length; k++) {
    const name = names[k];
    try {
      templates.set(name, parseTemplate(name, input.templates[name]));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }

  const base = input.site.base_url.replace(/\/+$/, '');
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  const all = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) all.push({ path: f.path, text: f.content.indexOf('\r') === -1 ? f.content : f.content.replace(/\r\n?/g, '\n') });
    else statics.push({ path: f.path, content: f.content });
  }

  const sources = [];
  for (const s of all) {
    const fm = parseFrontMatter(s.text);
    if (fm.error !== undefined) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.body = fm.body;
    s.post = s.path.startsWith('posts/');
    let own;
    for (const d of RESERVED) {
      if (d !== 'posts' && s.path.startsWith(`${d}/`)) {
        own = d;
        break;
      }
    }
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    sources.push(s);
  }

  const taken = new Map();
  const bySource = new Map();
  for (const s of sources) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    let set = taken.get(dir);
    if (set === undefined) {
      set = dir === '' ? new Set(RESERVED) : new Set();
      taken.set(dir, set);
    }
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), set);
    s.slug = slug;
    s.srcDir = dirOf(s.path);
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  const staticPaths = new Set();
  for (const f of statics) staticPaths.add(f.path);
  const broken = new Set();
  for (const s of sources) {
    const dir = s.srcDir;
    const env = {
      link: (target) => {
        const c = target.charCodeAt(0);
        if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
          for (let k = 1; k < target.length; k++) {
            const d = target.charCodeAt(k);
            if (d === 58) {
              if (k > 0) return target;
              break;
            }
            if (!((d >= 65 && d <= 90) || (d >= 97 && d <= 122) || (d >= 48 && d <= 57) || d === 43 || d === 45 || d === 46)) break;
          }
        }
        if (c === 47 || c === 35) return target;
        const hash = target.indexOf('#');
        const rel = hash === -1 ? target : target.slice(0, hash);
        const frag = hash === -1 ? '' : target.slice(hash);
        const path = rel === '' ? null : resolvePath(dir, rel);
        if (path !== null && bySource.has(path)) return `${bySource.get(path).url}${frag}`;
        if (path !== null && staticPaths.has(path)) return `${base}/${path}${frag}`;
        broken.add(`broken-link ${s.path} -> ${target}`);
        return target;
      },
    };
    const md = renderMarkdown(s.body, env);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  const posts = [];
  for (const s of sources) if (s.post) posts.push(s);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }

  const tagBySlug = new Map();
  const ownTags = (s) => {
    const names_ = s.data.tags ?? [];
    const out = [];
    const seen = new Set();
    for (const name of names_) {
      const slug = slugify(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      out.push(name);
    }
    return out;
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name);
      let tag = tagBySlug.get(slug);
      if (tag === undefined) {
        tag = { name, slug, url: `${base}/tags/${slug}/`, posts: [] };
        tagBySlug.set(slug, tag);
      }
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of sources) {
    if (s.post) continue;
    s.tagRefs = ownTags(s).map((name) => {
      const slug = slugify(name);
      return tagBySlug.get(slug) ?? { name, slug, url: '', posts: [] };
    });
  }
  const tags = [...tagBySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  const linkOf = (s) => (s === null ? null : {
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
  });

  const cardOf = (s) => ({
    title: s.data.title,
    url: s.url,
    date: s.data.date ?? '',
    date_long: s.data.date === undefined ? '' : longDate(s.data.date),
    summary: s.data.summary ?? '',
    excerpt: s.excerpt,
    reading_minutes: Math.max(1, Math.ceil(wordsOf(s.body) / 200)),
    tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
  });

  const cardOfCache = new Map();
  for (const p of posts) cardOfCache.set(p, cardOf(p));

  const output = {};
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cardOfCache.get(p));
  const ctx = { templates, rootOnly: rootOnlyTemplates(templates), rootCache: new Map() };

  const render = (name, vars) => {
    const nodes = templates.get(name);
    if (nodes === undefined) return null;
    const out = [];
    renderInto(nodes, { vars: { site, tags: allTags, recent, ...vars }, parent: null }, ctx, 0, false, out);
    return out.join('');
  };

  for (const s of sources) {
    const card = cardOfCache.get(s) ?? cardOf(s);
    const page = {
      ...card,
      slug: s.slug,
      content: s.html,
      toc: s.toc,
      newer: linkOf(s.newer ?? null),
      older: linkOf(s.older ?? null),
      is_post: s.post,
    };
    output[`${s.outDir}/index.html`] = render(s.layout, { page });
  }

  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cardOfCache.get(p)),
      pager: {
        number: k,
        total: pages,
        url: indexUrl(k),
        newer_url: k === 1 ? '' : indexUrl(k - 1),
        older_url: k === pages ? '' : indexUrl(k + 1),
      },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }

  for (const t of tags) {
    const html = render('tag', {
      tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cardOfCache.get(p)) },
    });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;

  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  const lines = [...report, ...broken].sort(byCodeUnits);
  let pageCount = 0;
  for (const s of sources) if (!s.post) pageCount++;
  lines.push(`built ${pageCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output[REPORT_FILE] = `${lines.join('\n')}\n`;

  return output;
}

/** `rel` (a link's path) from the directory `dir`, or null when it climbs out of the root. */
function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  const segs = rel.split('/');
  for (let k = 0; k < segs.length; k++) {
    const seg = segs[k];
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}
