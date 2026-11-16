// A fast CommonMark 0.31.2 + GFM 0.29 renderer that returns exactly the HTML
// marked 18.1.3 (default options: gfm on, breaks off, pedantic off) renders.
// Written from scratch for the make.fun markdown-render-speed-02 bounty:
// read the vendored marked baseline to learn its exact output, then wrote my
// own parser. No dependencies, no network, no wall clock, deterministic.
//
// Layout: small helpers, the grammar regexes, a block tokenizer, a lexer
// (block + inline), and a renderer. parse(markdown) -> HTML string.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Escape &, <, >, " and '. When `encode` is false, an & that already starts
// a character reference (&#123; &#xAB; &name;) is left alone.
function escapeHtml(text, encode) {
  if (encode) {
    if (/[&<>"']/.test(text)) return text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
    return text;
  }
  if (/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/.test(text)) {
    return text.replace(/[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g, (ch) => HTML_ESCAPES[ch]);
  }
  return text;
}

// Decode numeric character references in inline text. A bare & that is not a
// valid reference becomes &amp; (so it survives the later escape step).
function decodeEntities(text) {
  if (!/&#/.test(text)) return text;
  return text.replace(/&#(?:(\d{1,7})|[Xx]([A-Fa-f0-9]{1,6}));|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/g,
    (whole, dec, hex) => {
      if (dec === undefined && hex === undefined) return '&amp;';
      const code = dec === undefined ? parseInt(hex, 16) : parseInt(dec, 10);
      if (code === 0 || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) return '\uFFFD';
      if (code === 38) return '&amp;';
      return String.fromCodePoint(code);
    });
}

// encodeURI, but keep %25 as % (marked's behaviour), null on bad input.
function encodeHref(href) {
  try {
    return encodeURI(href).replace(/%25/g, '%');
  } catch {
    return null;
  }
}

// Split a table row line into cells, honouring \| escapes and trimming the
// optional leading/trailing pipe.
function splitTableRow(row, count) {
  const parts = row.replace(/\|/g, (ch, off, str) => {
    let escaped = false;
    for (let p = off - 1; p >= 0 && str[p] === '\\'; p--) escaped = !escaped;
    return escaped ? '|' : ' |';
  }).split(' |');
  let i = 0;
  if (parts[0].trim() === '') parts.shift();
  if (parts.length > 0 && parts[parts.length - 1].trim() === '') parts.pop();
  if (count !== undefined) {
    if (parts.length > count) parts.splice(count);
    else while (parts.length < count) parts.push('');
  }
  for (; i < parts.length; i++) parts[i] = parts[i].trim().replace(/\\\|/g, '|');
  return parts;
}

// Remove up to `n` trailing occurrences of `ch` (used for closing hashes /
// trailing backslashes). Mirrors marked's trimEnd helper.
function trimEndChar(text, ch) {
  const n = text.length;
  if (n === 0) return '';
  let s = 0;
  for (;;) {
    const c = text.charAt(n - s - 1);
    if (c === ch) s++;
    else break;
    if (s >= n) break;
  }
  return text.slice(0, n - s);
}

// Drop trailing blank lines, but keep at most one blank line at the end.
function stripTrailingBlanks(text) {
  const lines = text.split('\n');
  let last = lines.length - 1;
  for (; last >= 0 && /^[ \t]*$/.test(lines[last]); last--) { /* empty */ }
  return lines.length - last <= 2 ? text : lines.slice(0, last + 1).join('\n');
}

// Normalise a link label for lookup: trim, collapse whitespace, lower case
// (with the toLowerCase().toUpperCase().toLowerCase() round trip marked uses).
function normalizeLabel(label) {
  return label.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}

// Find the index of the closing paren that balances `open` in `text`, or -1
// when unbalanced (or -2 when the open paren never closes).
function findParenClose(text, open) {
  if (text.indexOf(open[0]) === -1 && text.indexOf(open[1]) === -1) return -1;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; }
    if (text[i] === open[0]) depth++;
    else if (text[i] === open[1]) {
      depth--;
      if (depth < 0) return i;
    }
  }
  return depth > 0 ? -2 : -1;
}

// Expand tabs to spaces (tab stops of 4), tracking the column offset.
function expandTabs(text, startCol) {
  let col = startCol;
  let out = '';
  for (const ch of text) {
    if (ch === '\t') {
      const w = 4 - (col % 4);
      out += ' '.repeat(w);
      col += w;
    } else {
      out += ch;
      col++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grammar
// ---------------------------------------------------------------------------

// Block tag names that start an HTML block (CommonMark condition 6).
const BLOCK_TAGS =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';

// Small "does this line start a block?" probes, cached per indent level.
const probeCache = new Map();
function probes(indent) {
  // marked's probe factories clamp the indent: n = clamp(indent - 1, 0, 3).
  // A bullet/hr/fence/heading/html/blockquote that starts within the item's
  // content column belongs to the item; only one that starts further left
  // (fewer leading spaces than the content column minus one) ends it.
  const n = Math.max(0, Math.min(3, indent - 1));
  let p = probeCache.get(n);
  if (p) return p;
  p = {
    bullet: new RegExp(`^ {0,${n}}(?:[*+-]|\\d{1,9}[.)])((?:[ \\t][^\\n]*)?(?:\\n|$))`),
    hr: new RegExp(`^ {0,${n}}((?:-[ \\t]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)`),
    fences: new RegExp(`^ {0,${n}}(?:\`\`\`|~~~)`),
    heading: new RegExp(`^ {0,${n}}#{1,6}(?:\\s|$)`),
    html: new RegExp(`^ {0,${n}}(?:</?(?:${BLOCK_TAGS})(?: +|$|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)`, 'i'),
    blockquote: new RegExp(`^ {0,${n}}>`)
  };
  p.n = n;
  probeCache.set(n, p);
  return p;
}

// Same dispatch, but for the previous line's content marked only tests
// fences/heading/html/hr (a bullet or blockquote there does not end the item).
function probeBreakContent(pr, line) {
  let k = 0;
  while (k < line.length && line[k] === ' ') k++;
  if (k > pr.n || k >= line.length) return false;
  const c = line[k];
  if (c === '\t') return false;
  switch (c) {
    case '`': case '~': return pr.fences.test(line);
    case '#': return pr.heading.test(line);
    case '<': return pr.html.test(line);
    case '*': case '-': case '_': return pr.hr.test(line);
    default: return false;
  }
}

// First line of a string without allocating a split array.
function firstLineOf(s) {
  const nl = s.indexOf('\n');
  return nl < 0 ? s : s.slice(0, nl);
}

// Index of the first non-space char (lines are short at the front).
function firstNonSpace(s) {
  let k = 0;
  while (k < s.length && s[k] === ' ') k++;
  return k;
}

// True when the string ends with a blank line (\n, spaces/tabs, \n,
// spaces/tabs) — the same as /\n[ \t]*\n[ \t]*$/ but a short scan from
// the end instead of a regex over the whole string.
function hasDoubleBlank(s) {
  let k = s.length;
  while (k > 0 && (s[k - 1] === ' ' || s[k - 1] === '\t')) k--;
  if (k === 0 || s[k - 1] !== '\n') return false;
  k--;
  while (k > 0 && (s[k - 1] === ' ' || s[k - 1] === '\t')) k--;
  return k > 0 && s[k - 1] === '\n';
}

// True when the line holds only spaces/tabs.
function isBlankLine(s) {
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (c !== ' ' && c !== '\t') return false;
  }
  return true;
}

// Do the list-continuation probes match this raw line? Only the regexes a
// line starting with this character could match are run: most prose lines
// start with a letter, which no probe can match, so all six are skipped.
function probeBreak(pr, line) {
  let k = 0;
  while (k < line.length && line[k] === ' ') k++;
  if (k > pr.n || k >= line.length) return false;
  const c = line[k];
  if (c === '\t') return false;
  switch (c) {
    case '`': case '~': return pr.fences.test(line);
    case '#': return pr.heading.test(line);
    case '<': return pr.html.test(line);
    case '>': return pr.blockquote.test(line);
    case '*': case '-': return pr.bullet.test(line) || pr.hr.test(line);
    case '+': return pr.bullet.test(line);
    case '_': return pr.hr.test(line);
    default:
      if (c >= '0' && c <= '9') return pr.bullet.test(line);
      return false;
  }
}

const RE = {
  // block
  newline: /^(?:[ \t]*(?:\n|$))+/,
  indentedCode: /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/,
  fences: /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}(?:(?=`)\1`*|(?=~)\1~*) *(?=\n|$)|$)/,
  hr: /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/,
  heading: /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/,
  // setext heading: text lines, then === or --- underline (gfm: table-aware)
  lheading: null, // built below
  listStart: /^( {0,3}(?:[*+-]|\d{1,9}[.)]))([ \t][^\n]*?)?(?:\n|$)/,
  htmlBlock: null, // built below
  def: null, // built below
  table: null, // built below
  paragraph: null, // built below
  text: /^[^\n]+/,
  // inline
  escape: /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/,
  codeSpan: /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/,
  hardBreak: /^( {2,}|\\)\n(?!\s*$)[ \t]*/,
  autolink: /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s\x00-\x1f<>]*|[a-zA-Z0-9.!#$%&'*+/=?_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_]))>/,
  htmlTag: null, // built below
  link: null, // built below
  refLink: null, // built below
  noLink: null, // built below
  refLinkSearch: null, // built below
  url: null, // built below
  backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,
  punctuation: /^((?![*_])[\s\p{P}\p{S}])/u,
  delOpen: /^~~?(?:((?!~)[\p{P}\p{S}])|[^\s~])/u,
  anyPunct: /\\([\p{P}\p{S}])/gu,
  anyPunctOutsideCode: /(`+)(?:[^`]|[^`][\s\S]*?[^`])\1(?!`)|`+|\\([\p{P}\p{S}])/gu,
  blockSkip: null, // built below
};

// The big composed regexes, built the same way marked composes them.
{
  const labelInner = /(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+/; // link label chars
  const labelInnerRef = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\\n]|\n(?![ \t]*\n))+/; // def/ref label
  const titlePat = /(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\\n]|\n(?!\n))*'|\((?:\\[\s\S]|[^()\\])*\))/; // def title
  const linkTitlePat = /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\((?:\\[\s\S]|[^)\\])*\)/; // inline-link title
  const hrefPat = /<(?:\\.|[^\n<>\\])+>|[^ \t\n\x00-\x1f]+|(?=\))/;
  // Horizontal rule, with its capturing group (group numbering matters when
  // this pattern is embedded inside lookaheads of other rules).
  const hrSrc = ' {0,3}((?:-[\\t ]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)';

  // link reference definition: [label]: <href> "title"
  RE.def = new RegExp(
    '^ {0,3}\\[(label)\\]: *(?:\\n[ \\t]*)?([^<\\s][^\\s]*|<.*?>)(?:(?: +(?:\\n[ \\t]*)?| *\\n[ \\t]*)(title))? *(?:\\n+|$)'
      .replace('label', labelInnerRef.source).replace('title', titlePat.source)
  );

  // HTML block (type 6/7, gfm)
  const comment = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
  const attr = / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/;
  const htmlBlockSrc =
    '^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n*|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>[^\\n]*\\n*|$)|<![A-Z][\\s\\S]*?(?:>[^\\n]*\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>[^\\n]*\\n*|$)|</?(tag)(?:[ \\t]+|\\n|/?>|$)[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)|<(?!(?:script|pre|style|textarea)(?![a-z0-9-]))([a-z][a-z0-9-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$)|</[a-z][a-z0-9-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ \t]*)+\\n|$))'
      .replace('comment', () => comment.source)
      .replace('tag', () => BLOCK_TAGS)
      .replace('attribute', () => attr.source);
  RE.htmlBlock = new RegExp(htmlBlockSrc, 'i');

  // setext heading (gfm variant: table-aware). Note the leading lookahead:
  // the text must not itself start with a block construct.
  const lheadingSrc =
    '^(?!bull |blockCode|fences|blockquote|heading|html|table)((?:.|\\n(?!\\s*?\\n|bull |fences|blockquote|heading|hr|html|table))+?)\\n {0,3}(=+|-+)[ \\t]*(?:\\n+|$)';
  RE.lheading = new RegExp(lheadingSrc
    .replace(/bull/g, () => ' {0,3}(?:[*+-]|\\d{1,9}[.)])')
    .replace(/blockCode/g, () => '(?: {4}| {0,3}\\t)')
    .replace(/fences/g, () => ' {0,3}(?:`{3,}|~{3,})')
    .replace(/blockquote/g, () => ' {0,3}>')
    .replace(/heading/g, () => ' {0,3}#{1,6}(?:\\s|$)')
    .replace(/hr/g, () => ' {0,3}(?:(?:-[\\t ]*){3,}|(?:_[ \\t]*){3,}|(?:\\*[ \\t]*){3,})(?:\\n+|$)')
    .replace(/html/g, () => ' {0,3}<[^\\n>]+>\\n')
    .replace(/table/g, () => ' {0,3}\\|?(?:[:\\- ]*\\|)+[\\:\\- ]*\\n'));

  // table: header line, delimiter row, body rows. The replacements are
  // first-occurrence string replacements, in marked's order, so a token word
  // inside an already-inserted pattern is never touched again.
  const tableSrc =
    '^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)';
  RE.table = new RegExp(tableSrc
    .replace('hr', () => hrSrc)
    .replace('heading', () => ' {0,3}#{1,6}(?:\\s|$)')
    .replace('blockquote', () => ' {0,3}>')
    .replace('code', () => '(?: {4}| {0,3}\t)[^\\n]')
    .replace('fences', () => ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
    .replace('list', () => ' {0,3}(?:[*+-]|1[.)])[ \\t]')
    .replace('html', () => ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)'.replace('tag', () => BLOCK_TAGS)));

  // Paragraph builder: the ae template with a given list-interrupt pattern
  // and an optional table alternative. The blockquote's inner paragraph (Ke)
  // takes any bullet and no table alternative.
  // The table pattern is embedded without its leading ^ (the caret-strip
  // marked's composer applies to every inserted regex).
  const tableNoCaret = RE.table.source.replace(/^\^/, '');
  function buildParagraph(listPat, withTable) {
    const src = '^([^\\n]+(?:\\n(?!hr|heading|lheading|blockquote|fences|list|html|table|[ \\t]+\\n)[^\\n]+)*)';
    let out = src
      .replace('hr', () => hrSrc)
      .replace('heading', () => ' {0,3}#{1,6}(?:\\s|$)')
      .replace('|lheading', () => '')
      .replace('blockquote', () => ' {0,3}>')
      .replace('fences', () => ' {0,3}(?:`{3,}(?=[^`\\n]*(?:\\n|$))|~~~)[^\\n]*(?:\\n|$)')
      .replace('list', () => listPat);
    if (withTable) out = out.replace('table', () => tableNoCaret);
    else out = out.replace('|table', () => '');
    out = out.replace('html', () => ' {0,3}(?:</?(?:tag)(?: +|\\n|/?>)|<(?:(?:script|pre|style|textarea)(?:[\\s>]|$)|!--)|<\\?|<![A-Za-z]|<!\\[CDATA\\[)'.replace('tag', () => BLOCK_TAGS));
    return new RegExp(out);
  }
  RE.paragraph = buildParagraph(' {0,3}(?:[*+-]|1[.)])[ \\t]+[^ \\t\\n]', true);

  // Blockquote: lines starting with >, whose first line may be a paragraph.
  const bqPara = buildParagraph(' {0,3}(?:[*+-]|\\d{1,9}[.)])(?:[ \\t]|\\n|$)', false);
  RE.blockquote = new RegExp(
    '^( {0,3}> ?(?:(?![ \\t]*(?:\\n|$))(paragraph)|[^\\n]*)(?:\\n|$))+'
      .replace('paragraph', () => bqPara.source.replace(/^\^/, '')));

  // inline tag: comment, closing tag, open tag, processing instruction, declaration, CDATA
  const tagAttr = /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/;
  RE.htmlTag = new RegExp(
    '^comment|^</[a-zA-Z][a-zA-Z0-9-]*\\s*>|^<[a-zA-Z][a-zA-Z0-9-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>'
      .replace('comment', () => /<!--(?:-?>|[\s\S]*?-->)/.source)
      .replace(/attribute/g, () => tagAttr.source)
  );

  // inline link / reference link label pieces
  const brackets = /\[(?:\\[\s\S]|[^\[\]\\])*\]/;
  const linkLabel = new RegExp(
    '(?:\\[(?:brackets|\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]|\\\\[\\s\\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\\])|[^\\[\\]\\\\`])*?'
      .replace(/brackets/g, brackets.source));
  const refInner = /(?!\s*\])(?:\\[\s\S]|[^\[\]\\]){1,999}/;
  const linkLabelLoose = new RegExp(
    '(?:[^\\[\\]\\\\`]*(?:\\[(?:brackets|\\\\[\\s\\S]|[^\\[\\]\\\\])*\\]|\\\\[\\s\\S]|`+(?!`)[^`]*?`+(?!`)|``+(?=\\]))){0,999}?[^\\[\\]\\\\`]*?'
      .replace(/brackets/g, brackets.source));

  RE.link = new RegExp(
    '^!?\\[(label)\\]\\([ \\t\\n]*(href)(?:(?:[ \\t]+(?:\\n[ \\t]*)?|\\n[ \\t]*)(title))?[ \\t\\n]*\\)'
      .replace('label', () => linkLabel.source)
      .replace('href', () => hrefPat.source)
      .replace('title', () => linkTitlePat.source));

  RE.refLink = new RegExp(
    '^!?\\[(label)\\]\\[(ref)\\]'
      .replace('label', () => linkLabel.source).replace('ref', () => labelInnerRef.source));
  RE.noLink = new RegExp(
    '^!?\\[(ref)\\](?:\\[\\])?'.replace('ref', () => labelInnerRef.source));

  // search for reference-style links while masking emphasis delimiters
  const refSearch = new RegExp(
    'reflink|nolink(?!\\()'
      .replace('reflink', () => new RegExp('^!?\\[(label)\\]\\[(ref)\\]'
        .replace('label', () => linkLabelLoose.source).replace('ref', () => refInner.source)).source.replace(/^\^/, ''))
      .replace('nolink', () => new RegExp('^!?\\[(ref)\\](?:\\[\\])?'
        .replace('ref', () => refInner.source)).source.replace(/^\^/, '')), 'g');

  RE.refLinkSearch = refSearch;

  // extended autolinks: scheme://, www., email, mailto:/xmpp:
  // (the mailto/xmpp protocol part uses the group-less email pattern so the
  // bare-email (@) stays group 2 in the final regex)
  const emailNoGroup = /[A-Za-z0-9._+-]+@[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
  const emailPat = /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![\w-])/;
  const emailProto = new RegExp('(?:mailto:email|xmpp:email(?:\\/[A-Za-z0-9@.]+)?)'.replace(/email/g, () => emailNoGroup.source));
  RE.url = new RegExp(
    '^emailProtocol|^((?:protocol):\\/\\/|www\\.)(?:[a-zA-Z0-9\\-]+\\.?)+[^\\s<]*|^email'
      .replace('emailProtocol', emailProto.source)
      .replace('protocol', /[hH][tT][tT][pP][sS]?|[fF][tT][pP]/.source)
      .replace('email', emailPat.source));

  // blockSkip: inline links, code spans and html tags, masked for emphasis
  const linkSkip = /\[(?:[^\[\]`]|(?<a>`+)[^`]+\k<a>(?!`))*?\]\((?:\\[\s\S]|[^\\\(\)]|\((?:\\[\s\S]|[^\\\(\)])*\))*\)/;
  const codeSkip = /(?<b>`+)[^`]+\k<b>(?!`)/;
  RE.blockSkip = new RegExp(
    'link|precode-code|html'
      .replace('link', linkSkip.source)
      .replace('precode-', '(?<!`)()')
      .replace('code', codeSkip.source)
      .replace('html', /<(?! )[^<>]*?>/.source), 'g');
}

// Emphasis/delimiter right-side matchers, built from the same templates marked
// uses (left/right flanking rules from the CommonMark emphasis spec).
// GFM uses: lDelim (one regex for * and _), rDelimAst (ht), rDelimUnd (kt),
// delRDelim (Rt). The pedantic variants (gt/mt) are not needed here.
function buildDelimRegexes() {
  const punct = /[\p{P}\p{S}]/u;
  const punctSpace = /[\s\p{P}\p{S}]/u;
  const notPunctSpace = /[^\s\p{P}\p{S}]/u;
  const punctNoTilde = /(?!~)[\p{P}\p{S}]/u;
  const punctSpaceNoTilde = /(?!~)[\s\p{P}\p{S}]/u;
  const notPunctSpaceTilde = /(?:[^\s\p{P}\p{S}]|~)/u;

  // left delimiter, * and _ in one regex: groups 1,2 belong to *, 3,4 to _.
  const lDelim = new RegExp(
    '^(?:\\*+(?:((?!\\*)(?!~)[\\p{P}\\p{S}])|([^\\s*]))?)|^_+(?:((?!_)(?!~)[\\p{P}\\p{S}])|([^\\s_]))?', 'u');

  const sub = (src, nps, ps, p) => new RegExp(src
    .replace(/notPunctSpace/g, () => nps.source)
    .replace(/punctSpace/g, () => ps.source)
    .replace(/punct/g, () => p.source), 'gu');

  // right delimiter for *: $e template, tilde-aware classes
  const rAstSrc = '^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)punct(\\*+)(?=[\\s]|$)|notPunctSpace(\\*+)(?!\\*)(?=punctSpace|$)|(?!\\*)punctSpace(\\*+)(?=notPunctSpace)|[\\s](\\*+)(?!\\*)(?=punct)|(?!\\*)punct(\\*+)(?!\\*)(?=punct)|notPunctSpace(\\*+)(?=notPunctSpace)';
  // right delimiter for _: kt template, plain classes
  const rUndSrc = '^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)punct(_+)(?=[\\s]|$)|notPunctSpace(_+)(?!_)(?=punctSpace|$)|(?!_)punctSpace(_+)(?=notPunctSpace)|[\\s](_+)(?!_)(?=punct)|(?!_)punct(_+)(?!_)(?=punct)';
  // right delimiter for ~~: bt template, plain classes
  const rDelSrc = '^[^~]+(?=[^~])|(?!~)punct(~~?)(?=[\\s]|$)|notPunctSpace(~~?)(?!~)(?=punctSpace|$)|(?!~)punctSpace(~~?)(?=notPunctSpace)|[\\s](~~?)(?!~)(?=punct)|(?!~)punct(~~?)(?!~)(?=punct)|notPunctSpace(~~?)(?=notPunctSpace)';

  return {
    lDelim,
    rDelimAst: sub(rAstSrc, notPunctSpaceTilde, punctSpaceNoTilde, punctNoTilde),
    rDelimUnd: sub(rUndSrc, notPunctSpace, punctSpace, punct),
    rDelimDel: sub(rDelSrc, notPunctSpace, punctSpace, punct),
  };
}
const DELIM = buildDelimRegexes();

// ---------------------------------------------------------------------------
// Block tokenizer
// ---------------------------------------------------------------------------

const BLANK_LINE = /^[ \t]*$/;
const ANY_LINE = /\n.*\n/;
const LIST_TASK = /^\[[ xX]\][ \t]+\S/;
const LIST_TASK_STRIP = /^\[[ xX]\][ \t]+/;
const LIST_CHECKBOX = /\[[ xX]\]/;
const LEADING_SPACE_TAB = /^[ \t]+/;
const NON_SPACE = /[^ ]/;
const SETEXT_LINE = /^ {0,3}(?:=+|-+) *$/;
const BLOCKQUOTE_START = /^ {0,3}>/;
const BLOCKQUOTE_MARKER_WS = /^( {0,3}>)([ \t]+)/gm;
const BLOCKQUOTE_SETEXT = /\n {0,3}((?:=+|-+)[ \t]*)(?=\n|$)/g;
const BLOCKQUOTE_MARKER = /^ {0,3}>[ \t]?/gm;
const CODE_INDENT = /^(?: {0,3}\t| {1,4})/gm;
const FENCE_INDENT = /^(\s+)(?:```)/;
const BEGIN_SPACE = /^\s+/;
const END_HASH = /#$/;
const END_SPACE_TAB = /[ \t]$/;
const START_SPACE = /^ /;
const END_SPACE = / $/;
const NEWLINE_GLOBAL = /\n/g;
const TAB_GLOBAL = /\t/g;
const LIST_NESTING = /^ {1,4}(?=( {4})*[^ ])/g;
const HR_BRACKETS = /^<(.*)>$/;
const TABLE_DELIM = /[:|]/;
const TABLE_ALIGN_TRIM = /^\||\| *$/g;
const TABLE_ROW_BLANK = /\n[ \t]*$/;
const ALIGN_RIGHT = /^ *-+: *$/;
const ALIGN_CENTER = /^ *:-+: *$/;
const ALIGN_LEFT = /^ *:-+ *$/;
const START_A_TAG = /^<a /i;
const END_A_TAG = /^<\/a>/i;
const START_PRE_TAG = /^<(pre|code|kbd|script)(\s|>)/i;
const END_PRE_TAG = /^<\/(pre|code|kbd|script)(\s|>)/i;
const START_ANGLE = /^</;
const END_ANGLE = />$/;
const ALPHA_NUM = /[\p{L}\p{N}]/u;

// How many leading spaces (0..3) the source has at this point.
function leadingSpaces(src) {
  let i = 0;
  while (i < 3 && src[i] === ' ') i++;
  return i;
}

// Does a setext underline line (=== or ---) appear before the next blank
// line? Used to decide whether the lheading regex can possibly match.
function hasSetextAhead(src) {
  let nl = src.indexOf('\n');
  if (nl === -1) return false;
  let pos = nl + 1;
  while (pos < src.length) {
    let end = src.indexOf('\n', pos);
    if (end === -1) end = src.length;
    // blank line?
    let blank = true;
    for (let i = pos; i < end; i++) {
      if (src[i] !== ' ' && src[i] !== '\t') { blank = false; break; }
    }
    if (blank) return false;
    // setext underline? skip <=3 spaces, then = or - run, then spaces only
    let i = pos;
    while (i < end && src[i] === ' ' && i - pos < 3) i++;
    if (i < end && (src[i] === '=' || src[i] === '-')) {
      const ch = src[i];
      while (i < end && src[i] === ch) i++;
      let ok = true;
      for (; i < end; i++) if (src[i] !== ' ' && src[i] !== '\t') { ok = false; break; }
      if (ok) return true;
    }
    pos = end + 1;
  }
  return false;
}

// Does the second line look like a table delimiter row (has - and | or :)?
function tableAhead(src) {
  const nl = src.indexOf('\n');
  if (nl === -1) return false;
  let end = src.indexOf('\n', nl + 1);
  if (end === -1) end = src.length;
  let dash = false, pipe = false;
  for (let i = nl + 1; i < end; i++) {
    const c = src[i];
    if (c === '-') dash = true;
    else if (c === '|' || c === ':') pipe = true;
    if (dash && pipe) return true;
  }
  return false;
}

class BlockTokenizer {
  constructor() { this.lexer = null; }

  space(src) {
    const m = RE.newline.exec(src);
    if (m && m[0].length > 0) return { type: 'space', raw: m[0] };
  }

  code(src) {
    const m = RE.indentedCode.exec(src);
    if (!m) return;
    const raw = stripTrailingBlanks(m[0]);
    const text = raw.replace(CODE_INDENT, '');
    return { type: 'code', raw, codeBlockStyle: 'indented', text };
  }

  fences(src) {
    const m = RE.fences.exec(src);
    if (!m) return;
    const raw = m[0];
    let text = m[3] || '';
    // indent compensation: if the fence itself is indented, strip that much
    // leading whitespace from every code line.
    const comp = raw.match(FENCE_INDENT);
    if (comp !== null) {
      const indent = comp[1];
      text = text.split('\n').map((line) => {
        const sp = line.match(BEGIN_SPACE);
        if (sp === null) return line;
        return line.slice(Math.min(sp[0].length, indent.length));
      }).join('\n');
    }
    const lang = m[2] ? m[2].trim().replace(RE.anyPunct, '$1') : m[2];
    return { type: 'code', raw, lang, text };
  }

  heading(src) {
    const m = RE.heading.exec(src);
    if (!m) return;
    let text = m[2].trim();
    if (END_HASH.test(text)) {
      const stripped = trimEndChar(text, '#');
      if (!stripped || END_SPACE_TAB.test(stripped)) text = stripped.trim();
    }
    return { type: 'heading', raw: trimEndChar(m[0], '\n'), depth: m[1].length, text, tokens: this.lexer.inline(text) };
  }

  hr(src) {
    const m = RE.hr.exec(src);
    if (m) return { type: 'hr', raw: trimEndChar(m[0], '\n') };
  }

  blockquote(src) {
    const m = RE.blockquote.exec(src);
    if (!m) return;
    let lines = trimEndChar(m[0], '\n').split('\n');
    let raw = '', text = '';
    const tokens = [];
    while (lines.length > 0) {
      let lazy = false;
      const chunk = [];
      let p;
      for (p = 0; p < lines.length; p++) {
        if (BLOCKQUOTE_START.test(lines[p])) { chunk.push(lines[p]); lazy = true; }
        else if (!lazy) chunk.push(lines[p]);
        else break;
      }
      lines = lines.slice(p);
      const joined = chunk.join('\n');
      const cleaned = joined
        .replace(BLOCKQUOTE_MARKER_WS, (g, marker, ws) => marker + expandTabs(ws, marker.length))
        .replace(BLOCKQUOTE_SETEXT, '\n    $1')
        .replace(BLOCKQUOTE_MARKER, '');
      raw = raw ? raw + '\n' + joined : joined;
      text = text ? text + '\n' + cleaned : cleaned;
      const savedTop = this.lexer.state.top;
      this.lexer.state.top = true;
      this.lexer.blockTokens(cleaned, tokens, true);
      this.lexer.state.top = savedTop;
      if (lines.length === 0) break;
      const last = tokens.at(-1);
      if (last && (last.type === 'code' || last.type === 'heading' || last.type === 'hr' || last.type === 'html' || last.type === 'table')) break;
      if (last && last.type === 'blockquote') {
        const rest = lines.join('\n');
        const reparsed = last.raw + '\n' + rest.replace(BLOCKQUOTE_MARKER, '');
        const nested = this.blockquote(reparsed);
        tokens[tokens.length - 1] = nested;
        const leftover = reparsed.substring(nested.raw.length).replace(/^\n/, '');
        const leftLines = leftover ? leftover.split('\n').length : 0;
        const consumedLines = leftLines ? lines.slice(0, -leftLines) : lines;
        if (consumedLines.length > 0) raw = raw + '\n' + consumedLines.join('\n');
        text = text.substring(0, text.length - last.text.length) + nested.text;
        lines = lines.slice(consumedLines.length);
        if (lines.length > 0 && BLOCKQUOTE_START.test(lines[0])) continue;
        break;
      } else if (last && last.type === 'list') {
        const combined = last.raw + '\n' + lines.join('\n');
        const relisted = this.list(combined);
        tokens[tokens.length - 1] = relisted;
        const extra = relisted.raw.length > last.raw.length
          ? combined.slice(last.raw.length + 1, relisted.raw.length).split('\n').length : 0;
        if (extra > 0) {
          const extraText = lines.slice(0, extra).join('\n');
          raw = raw + '\n' + extraText;
          text = text + '\n' + extraText;
        }
        lines = lines.slice(extra);
        continue;
      }
    }
    return { type: 'blockquote', raw, tokens, text };
  }

  list(src) {
    let m = RE.listStart.exec(src);
    if (!m) return;
    const orig = src;
    const consumed = () => orig.length - src.length;
    let bullet = m[1].trim();
    const ordered = bullet.length > 1;
    const list = { type: 'list', raw: '', ordered, start: ordered ? +bullet.slice(0, -1) : '', loose: false, items: [] };
    bullet = ordered ? `\\d{1,9}\\${bullet.slice(-1)}` : `\\${bullet}`;
    const itemRe = new RegExp(`^( {0,3}${bullet})((?:[ \\t][^\\n]*)?(?:\\n|$))`);
    let sawBlank = false;
    while (src) {
      let emptyItem = false;
      let itemText = '';
      if (!(m = itemRe.exec(src)) || RE.hr.test(src)) break;
      const itemStart = consumed();
      src = src.substring(m[0].length);
      const firstLine = firstLineOf(m[2]);
      const bulletLen = m[1].length;
      let content = firstLine.includes('\t')
        ? firstLine.replace(LEADING_SPACE_TAB, (v) => expandTabs(v, bulletLen)) : firstLine;
      let nextLine = firstLineOf(src);
      let isEmpty = !content.trim();
      let indent = 0;
      if (isEmpty) indent = bulletLen + 1;
      else {
        indent = content.search(NON_SPACE);
        if (indent > 4) indent = 1;
        itemText = content.slice(indent);
        indent += bulletLen;
      }
      if (isEmpty && BLANK_LINE.test(nextLine)) {
        src = src.substring(nextLine.length + 1);
        emptyItem = true;
      }
      if (!emptyItem) {
        const pr = probes(indent);
        while (src) {
          const line = firstLineOf(src);
          nextLine = line;
          const expanded = line.includes('\t')
            ? line.replace(LEADING_SPACE_TAB, (v) => expandTabs(v, 0)) : line;
          if (probeBreak(pr, line)) break;
          if (firstNonSpace(expanded) >= indent || isBlankLine(line)) {
            itemText += '\n' + expanded.slice(indent);
          } else {
            if (isEmpty || firstNonSpace(content.includes('\t') ? content.replace(TAB_GLOBAL, '    ') : content) >= 4 ||
                probeBreakContent(pr, content)) break;
            const asSetext = SETEXT_LINE.test(line) && RE.lheading.test(content + '\n' + line)
              ? '    ' + expanded.replace(/^ {0,3}/, '') : line;
            itemText += '\n' + asSetext;
          }
          isEmpty = isBlankLine(line);
          src = src.substring(line.length + 1);
          content = expanded.slice(indent);
        }
      }
      const itemRaw = orig.slice(itemStart, consumed());
      if (!list.loose) {
        if (sawBlank) list.loose = true;
        else if (hasDoubleBlank(itemRaw)) sawBlank = true;
      }
      list.items.push({ type: 'list_item', raw: itemRaw, task: LIST_TASK.test(itemText), loose: false, text: itemText, tokens: [] });
    }
    const lastItem = list.items.at(-1);
    if (!lastItem) return;
    lastItem.raw = lastItem.raw.trimEnd();
    lastItem.text = lastItem.text.trimEnd();
    list.raw = orig.slice(0, consumed()).trimEnd();
    for (const item of list.items) {
      this.lexer.state.top = false;
      item.tokens = this.lexer.blockTokens(item.text, []);
      if (!list.loose) {
        const spaces = item.tokens.filter((t) => t.type === 'space');
        if (spaces.length > 0 && spaces.some((t) => ANY_LINE.test(t.raw))) list.loose = true;
      }
    }
    for (const item of list.items) {
      const first = item.tokens[0];
      if (item.task && (first && (first.type === 'text' || first.type === 'paragraph'))) {
        item.text = item.text.replace(LIST_TASK_STRIP, '');
        first.raw = first.raw.replace(LIST_TASK_STRIP, '');
        first.text = first.text.replace(LIST_TASK_STRIP, '');
        for (let g = this.lexer.inlineQueue.length - 1; g >= 0; g--) {
          if (LIST_TASK.test(this.lexer.inlineQueue[g].src)) {
            this.lexer.inlineQueue[g].src = this.lexer.inlineQueue[g].src.replace(LIST_TASK_STRIP, '');
            break;
          }
        }
        const cb = LIST_CHECKBOX.exec(item.raw);
        if (cb) {
          const checkbox = { type: 'checkbox', raw: cb[0] + ' ', checked: cb[0] !== '[ ]' };
          item.checked = checkbox.checked;
          if (list.loose) {
            if (item.tokens[0] && (item.tokens[0].type === 'paragraph' || item.tokens[0].type === 'text') &&
                'tokens' in item.tokens[0] && item.tokens[0].tokens) {
              item.tokens[0].raw = checkbox.raw + item.tokens[0].raw;
              item.tokens[0].text = checkbox.raw + item.tokens[0].text;
              item.tokens[0].tokens.unshift(checkbox);
            } else {
              item.tokens.unshift({ type: 'paragraph', raw: checkbox.raw, text: checkbox.raw, tokens: [checkbox] });
            }
          } else {
            item.tokens.unshift(checkbox);
          }
        }
      } else if (item.task) {
        item.task = false;
      }
    }
    if (list.loose) {
      for (const item of list.items) {
        item.loose = true;
        for (const tok of item.tokens) if (tok.type === 'text') tok.type = 'paragraph';
      }
    }
    return list;
  }

  html(src) {
    const m = RE.htmlBlock.exec(src);
    if (!m) return;
    const raw = stripTrailingBlanks(m[0]);
    return { type: 'html', block: true, raw, pre: m[1] === 'pre' || m[1] === 'script' || m[1] === 'style', text: raw };
  }

  def(src) {
    const m = RE.def.exec(src);
    if (!m) return;
    if (!START_ANGLE.test(m[2]) && findParenClose(m[2], '()') !== -1) return;
    const tag = normalizeLabel(m[1]);
    const href = m[2] ? m[2].replace(HR_BRACKETS, '$1').replace(RE.anyPunct, '$1') : '';
    const title = m[3] ? m[3].substring(1, m[3].length - 1).replace(RE.anyPunct, '$1') : m[3];
    return { type: 'def', tag, raw: trimEndChar(m[0], '\n'), href, title };
  }

  table(src) {
    const m = RE.table.exec(src);
    if (!m || !TABLE_DELIM.test(m[2])) return;
    const header = splitTableRow(m[1]);
    const alignParts = m[2].replace(TABLE_ALIGN_TRIM, '').split('|');
    const rowLines = m[3] && m[3].trim() ? m[3].replace(TABLE_ROW_BLANK, '').split('\n') : [];
    const table = { type: 'table', raw: trimEndChar(m[0], '\n'), header: [], align: [], rows: [] };
    if (header.length !== alignParts.length) return;
    for (const part of alignParts) {
      if (ALIGN_RIGHT.test(part)) table.align.push('right');
      else if (ALIGN_CENTER.test(part)) table.align.push('center');
      else if (ALIGN_LEFT.test(part)) table.align.push('left');
      else table.align.push(null);
    }
    for (let i = 0; i < header.length; i++) {
      table.header.push({ text: header[i], tokens: this.lexer.inline(header[i]), header: true, align: table.align[i] });
    }
    for (const line of rowLines) {
      table.rows.push(splitTableRow(line, header.length).map((cell, i) => ({
        text: cell, tokens: this.lexer.inline(cell), header: false, align: table.align[i]
      })));
    }
    return table;
  }

  lheading(src) {
    const m = RE.lheading.exec(src);
    if (!m) return;
    const text = m[1].trim();
    return { type: 'heading', raw: trimEndChar(m[0], '\n'), depth: m[2].charAt(0) === '=' ? 1 : 2, text, tokens: this.lexer.inline(text) };
  }

  paragraph(src) {
    const m = RE.paragraph.exec(src);
    if (!m) return;
    const text = m[1].charAt(m[1].length - 1) === '\n' ? m[1].slice(0, -1) : m[1];
    return { type: 'paragraph', raw: m[0], text, tokens: this.lexer.inline(text) };
  }

  text(src) {
    const m = RE.text.exec(src);
    if (m) return { type: 'text', raw: m[0], text: m[0], tokens: this.lexer.inline(m[0]) };
  }
}

// ---------------------------------------------------------------------------
// Lexer: block pass, then the queued inline pass
// ---------------------------------------------------------------------------

class Lexer {
  constructor() {
    this.tokens = [];
    this.tokens.links = Object.create(null);
    this.tokenizer = new BlockTokenizer();
    this.tokenizer.lexer = this;
    this.inlineQueue = [];
    this.state = { inLink: false, inRawBlock: false, linkEmitted: false, linkParenPossible: true, top: true };
  }

  lex(src) {
    src = src.replace(/\r\n|\r/g, '\n');
    this.blockTokens(src, this.tokens);
    for (let i = 0; i < this.inlineQueue.length; i++) {
      const q = this.inlineQueue[i];
      this.state.inRawBlock = false;
      this.inlineTokens(q.src, q.tokens);
    }
    this.inlineQueue = [];
    return this.tokens;
  }

  blockTokens(src, tokens = [], inBlockquote = false) {
    this.tokenizer.lexer = this;
    let prevLen = Infinity;
    while (src) {
      if (src.length < prevLen) prevLen = src.length;
      else throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
      let tok;
      const c0 = src[0];
      const ind = leadingSpaces(src);
      const afterIndent = src[ind];
      // blank lines
      if (c0 === '\n' || c0 === ' ' || c0 === '\t') {
        if ((tok = this.tokenizer.space(src))) {
          src = src.substring(tok.raw.length);
          const prev = tokens.at(-1);
          if (tok.raw.length === 1 && prev !== undefined) prev.raw += '\n';
          else tokens.push(tok);
          continue;
        }
      }
      // indented code: 4 spaces or a tab at the line start
      if ((c0 === ' ' && src[1] === ' ' && src[2] === ' ' && src[3] === ' ') || c0 === '\t' ||
          (c0 === ' ' && src[1] === '\t') || (c0 === ' ' && src[1] === ' ' && src[2] === '\t') ||
          (c0 === ' ' && src[1] === ' ' && src[2] === ' ' && src[3] === '\t')) {
        if ((tok = this.tokenizer.code(src))) {
          src = src.substring(tok.raw.length);
          const prev = tokens.at(-1);
          if (prev && (prev.type === 'paragraph' || prev.type === 'text')) {
            prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + tok.raw;
            prev.text += '\n' + tok.text;
            this.inlineQueue.at(-1).src = prev.text;
          } else tokens.push(tok);
          continue;
        }
      }
      if (afterIndent === '`' || afterIndent === '~') {
        if ((tok = this.tokenizer.fences(src))) { src = src.substring(tok.raw.length); tokens.push(tok); continue; }
      }
      if (afterIndent === '#') {
        if ((tok = this.tokenizer.heading(src))) { src = src.substring(tok.raw.length); tokens.push(tok); continue; }
      }
      if (afterIndent === '-' || afterIndent === '_' || afterIndent === '*') {
        if ((tok = this.tokenizer.hr(src))) { src = src.substring(tok.raw.length); tokens.push(tok); continue; }
      }
      if (afterIndent === '>') {
        if ((tok = this.tokenizer.blockquote(src))) { src = src.substring(tok.raw.length); tokens.push(tok); continue; }
      }
      if (afterIndent === '*' || afterIndent === '+' || afterIndent === '-' ||
          (afterIndent >= '0' && afterIndent <= '9')) {
        if ((tok = this.tokenizer.list(src))) { src = src.substring(tok.raw.length); tokens.push(tok); continue; }
      }
      if (afterIndent === '<') {
        if ((tok = this.tokenizer.html(src))) { src = src.substring(tok.raw.length); tokens.push(tok); continue; }
      }
      if (afterIndent === '[') {
        if ((tok = this.tokenizer.def(src))) {
          src = src.substring(tok.raw.length);
          const prev = tokens.at(-1);
          if (prev && (prev.type === 'paragraph' || prev.type === 'text')) {
            prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + tok.raw;
            prev.text += '\n' + tok.raw;
            this.inlineQueue.at(-1).src = prev.text;
          } else {
            if (!this.tokens.links[tok.tag]) this.tokens.links[tok.tag] = { href: tok.href, title: tok.title };
            tokens.push(tok);
          }
          continue;
        }
      }
      if (tableAhead(src)) {
        if ((tok = this.tokenizer.table(src))) { src = src.substring(tok.raw.length); tokens.push(tok); continue; }
      }
      if (hasSetextAhead(src)) {
        if ((tok = this.tokenizer.lheading(src))) { src = src.substring(tok.raw.length); tokens.push(tok); continue; }
      }
      if (this.state.top && (tok = this.tokenizer.paragraph(src))) {
        const prev = tokens.at(-1);
        if (inBlockquote && prev && prev.type === 'paragraph') {
          prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + tok.raw;
          prev.text += '\n' + tok.text;
          this.inlineQueue.pop();
          this.inlineQueue.at(-1).src = prev.text;
        } else tokens.push(tok);
        inBlockquote = false;
        src = src.substring(tok.raw.length);
        continue;
      }
      if ((tok = this.tokenizer.text(src))) {
        src = src.substring(tok.raw.length);
        const prev = tokens.at(-1);
        if (prev && prev.type === 'text') {
          prev.raw += (prev.raw.endsWith('\n') ? '' : '\n') + tok.raw;
          prev.text += '\n' + tok.text;
          this.inlineQueue.pop();
          this.inlineQueue.at(-1).src = prev.text;
        } else tokens.push(tok);
        continue;
      }
      if (src) throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
    }
    this.state.top = true;
    return tokens;
  }

  inline(src, tokens = []) {
    this.inlineQueue.push({ src, tokens });
    return tokens;
  }

  inlineTokens(src, tokens = []) {
    const saved = this.state.linkParenPossible;
    this.state.linkParenPossible = saved && src.includes(')');
    try {
      return this.inlineLoop(src, tokens);
    } finally {
      this.state.linkParenPossible = saved;
    }
  }
}

// ---------------------------------------------------------------------------
// Inline tokenizer
// ---------------------------------------------------------------------------

function isAlnum(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9');
}

function isEmailChar(ch) {
  return isAlnum(ch) || ch === '.' || ch === '!' || ch === '#' || ch === '$' || ch === '%' ||
    ch === '&' || ch === "'" || ch === '*' || ch === '+' || ch === '/' || ch === '=' ||
    ch === '?' || ch === '_' || ch === '`' || ch === '{' || ch === '|' || ch === '}' ||
    ch === '~' || ch === '-';
}

// Does an email-like run (email chars followed by @) start at i?
function emailAhead(s, i) {
  let j = i;
  while (j < s.length && isEmailChar(s[j])) j++;
  return j > i && s[j] === '@';
}

// Do 2+ spaces and then a newline start at i?
function twoSpacesNewline(s, i) {
  if (s[i] !== ' ') return false;
  let j = i;
  while (j < s.length && s[j] === ' ') j++;
  return j - i >= 2 && s[j] === '\n';
}

function isWwwStart(s, i, sliceStart) {
  if (s[i] !== 'w' || s[i + 1] !== 'w' || s[i + 2] !== 'w' || s[i + 3] !== '.') return false;
  if (i === sliceStart) return true;
  const prev = s[i - 1];
  // the text regex's lookbehind allows whitespace, *, _, ~ or ( before www.
  return prev === '*' || prev === '_' || prev === '~' || prev === '(' || /\s/.test(prev);
}

// Next inline-construct starter, found with one regex scan (C++ speed).
// One alternation covers every stop the text regex knows: construct starters
// (\ < ! [ ` * ~ _), email @, www., http/https, ftp://, mailto:/xmpp:, and
// the newline a hard break hangs on. Each match is then verified cheaply.
const TEXT_STOP_RE = /[\\<!\[`*~_]|www\.|https?|ftp:\/\/|mailto:|xmpp:|\n/gi;

// Cheap pre-check for the autolink-url regex: true whenever the regex could
// match at the start (false positives are fine, false negatives are not).
// Schemes are checked literally (mailto:/xmpp:/www. are lowercase-only in
// the regex; http/https/ftp are case-insensitive); a bare email needs an
// email-char run followed by @.
function urlMayMatch(s) {
  // A scheme first letter can also start a bare email (foo@bar...), so a
  // failed scheme check falls through to the email scan below, never false.
  const c = s.charCodeAt(0);
  if (c === 104 || c === 72) { // h/H: http:// or https://
    if ((s.charCodeAt(1) | 32) === 116 && (s.charCodeAt(2) | 32) === 116 && (s.charCodeAt(3) | 32) === 112) {
      const e = s.charCodeAt(4) | 32;
      if (e === 115) { if (s.charCodeAt(5) === 58 && s.charCodeAt(6) === 47 && s.charCodeAt(7) === 47) return true; }
      else if (e === 58 && s.charCodeAt(5) === 47 && s.charCodeAt(6) === 47) return true;
    }
  } else if (c === 102 || c === 70) { // f/F: ftp://
    if ((s.charCodeAt(1) | 32) === 116 && (s.charCodeAt(2) | 32) === 112 &&
        s.charCodeAt(3) === 58 && s.charCodeAt(4) === 47 && s.charCodeAt(5) === 47) return true;
  } else if (c === 109) { // mailto:
    if (s.startsWith('ailto:', 1)) return true;
  } else if (c === 120) { // xmpp:
    if (s.startsWith('mpp:', 1)) return true;
  } else if (c === 119) { // www.
    if (s.startsWith('ww.', 1)) return true;
  }
  // bare email: email chars then @
  if (!isEmailChar(s[0])) return false;
  let j = 0;
  while (j < s.length && isEmailChar(s[j])) j++;
  return s[j] === '@';
}

// Replicates marked's inline text regex: the end index of the plain-text run
// starting at p. The run stops before any character that could start another
// inline construct, before a hard-break marker, and before an autolink-like
// pattern (scheme://, www., email), so the loop can try those tokenizers.
// The stop positions are found with one regex scan instead of a
// character-by-character loop, which is much faster on long plain runs.
function scanTextEnd(s, p) {
  const n = s.length;
  // a lone non-alphanumeric char before mailto:/xmpp: is its own text token
  if (!isAlnum(s[p]) && (s.startsWith('mailto:', p + 1) || s.startsWith('xmpp:', p + 1))) return p + 1;
  // consume the first character(s): a run of backticks/tildes, or one char
  let i;
  const c0 = s[p];
  if (c0 === '`' || c0 === '~') {
    i = p;
    while (i < n && s[i] === c0) i++;
  } else {
    i = p + 1;
  }
  // stops that apply right after the first character
  if (i < n) {
    if (s[i] === '`' || s[i] === '~') return i;
    if (twoSpacesNewline(s, i)) return i;
    if (emailAhead(s, i)) return i;
  }
  TEXT_STOP_RE.lastIndex = i;
  let end = n;
  let m;
  while ((m = TEXT_STOP_RE.exec(s)) !== null) {
    const j = m.index;
    const c = m[0].charCodeAt(0);
    if (c === 92 || c === 60 || c === 33 || c === 91 || c === 96 || c === 42 || c === 126 || c === 95) { end = j; break; }
    if (c === 10) {
      // hard break: 2+ spaces then a newline, after a non-space char
      let f = j;
      while (f > i && s[f - 1] === ' ') f--;
      if (j - f >= 2 && f > p && s[f - 1] !== ' ') { end = f; break; }
      continue;
    }
    if (c === 119) {
      // www. at the slice start or after whitespace, *, _, ~ or (
      if (isWwwStart(s, j, p)) { end = j; break; }
      continue;
    }
    if (c === 104 || c === 72 || c === 102 || c === 70) { end = j; break; } // http/https, ftp://
    // mailto:/xmpp: after a non-alphanumeric char (lowercase only, as in
    // the text regex; an uppercase variant is not a stop, keep scanning)
    if ((m[0] === 'mailto:' || m[0] === 'xmpp:') && j > p && !isAlnum(s[j - 1])) { end = j; break; }
  }
  // Email stop, computed separately: its trigger (@) sits to the right of the
  // stop, and an emphasis char inside the email run (e.g. _ in a.b-c_d@x)
  // would otherwise hide the stop from the left-to-right scan above.
  let at = s.indexOf('@', i);
  while (at > 0) {
    let r = at;
    while (r > i && isEmailChar(s[r - 1])) r--;
    if (r < at && r >= i) { end = Math.min(end, r); break; }
    at = s.indexOf('@', at + 1);
  }
  return end;
}

// Last index where an emphasis/delimiter run could close, per delimiter.
function lastPossibleClosers(masked) {
  const idx = { '*': -1, '_': -1 };
  let del = -1;
  const n = masked.length;
  for (let s = 0; s < n; s++) {
    const r = masked[s];
    if (r !== '*' && r !== '_' && r !== '~') continue;
    const before = s === 0 ? '\n' : masked[s - 1];
    let i = s + 1;
    while (i < n && masked[i] === r) i++;
    if (before !== ' ' && before !== '\t' && before !== '\n' && before !== '\r' && before !== '\f') {
      if (r === '~') del = s;
      else idx[r] = s;
    }
    s = i - 1;
  }
  return { star: idx['*'], und: idx['_'], del };
}

class InlineTokenizer {
  constructor(lexer) { this.lexer = lexer; }

  // Does the label contain a tag/autolink that is not closed inside it?
  // (a link whose label holds one is not a link at all)
  hasUnclosedTag(src, label, offset) {
    if (!label.includes('<')) return false;
    for (let s = 0; s < label.length; s++) {
      if (label[s] === '\\') { s++; continue; }
      if (label[s] === '`') {
        const m = RE.codeSpan.exec(label.slice(s));
        if (m) { s += m[0].length - 1; continue; }
      }
      if (label[s] !== '<') continue;
      const rest = src.slice(offset + s);
      const m = RE.htmlTag.exec(rest) || RE.autolink.exec(rest);
      if (m) {
        if (m[0].length > label.length - s) return true;
        s += m[0].length - 1;
      }
    }
    return false;
  }

  // Build a link/image token, parsing the label's inline content.
  makeLink(match, ref, raw) {
    const lexer = this.lexer;
    const label = match[1].replace(/\\([\[\]])/g, '$1');
    const isImage = match[0].charAt(0) === '!';
    const savedLink = lexer.state.inLink;
    const savedEmitted = lexer.state.linkEmitted;
    const savedRawBlock = lexer.state.inRawBlock;
    lexer.state.inLink = true;
    lexer.state.linkEmitted = false;
    const labelTokens = lexer.inlineTokens(label);
    const nested = lexer.state.linkEmitted;
    lexer.state.linkEmitted = savedEmitted;
    lexer.state.inLink = savedLink;
    if (!isImage) {
      if (nested) {
        lexer.state.inRawBlock = savedRawBlock;
        return;
      }
      lexer.state.linkEmitted = true;
    }
    return {
      type: isImage ? 'image' : 'link',
      raw, href: ref.href, title: ref.title || null, text: label, tokens: labelTokens
    };
  }

  escape(src) {
    const m = RE.escape.exec(src);
    if (m) return { type: 'escape', raw: m[0], text: m[1] };
  }

  tag(src) {
    const m = RE.htmlTag.exec(src);
    if (!m) return;
    const st = this.lexer.state;
    if (!st.inLink && START_A_TAG.test(m[0])) st.inLink = true;
    else if (st.inLink && END_A_TAG.test(m[0])) st.inLink = false;
    if (!st.inRawBlock && START_PRE_TAG.test(m[0])) st.inRawBlock = true;
    else if (st.inRawBlock && END_PRE_TAG.test(m[0])) st.inRawBlock = false;
    return { type: 'html', raw: m[0], inLink: st.inLink, inRawBlock: st.inRawBlock, block: false, text: m[0] };
  }

  link(src) {
    if (this.lexer.state.linkParenPossible === false) return;
    const m = RE.link.exec(src);
    if (!m) return;
    const offset = m[0].charAt(0) === '!' ? 2 : 1;
    if (this.hasUnclosedTag(src, m[1], offset)) return;
    const hrefRaw = m[2].trim();
    if (START_ANGLE.test(hrefRaw)) {
      if (!END_ANGLE.test(hrefRaw)) return;
      const stripped = trimEndChar(hrefRaw.slice(0, -1), '\\');
      if ((hrefRaw.length - stripped.length) % 2 === 0) return;
    } else {
      const close = findParenClose(m[2], '()');
      if (close === -2) return;
      if (close > -1) {
        const h = (m[0].indexOf('!') === 0 ? 5 : 4) + m[1].length + close;
        m[2] = m[2].substring(0, close);
        m[0] = m[0].substring(0, h).trim();
        m[3] = '';
      }
    }
    const r = trimEndChar(m[0].slice(0, -1), '\\');
    if ((m[0].length - r.length) % 2 === 0) return;
    let href = m[2];
    const title = m[3] ? m[3].slice(1, -1) : '';
    href = href.trim();
    if (START_ANGLE.test(href)) href = href.slice(1, -1);
    return this.makeLink(m, {
      href: href && href.replace(RE.anyPunct, '$1'),
      title: title && title.replace(RE.anyPunct, '$1')
    }, m[0]);
  }

  reflink(src, links) {
    const m = RE.refLink.exec(src) || RE.noLink.exec(src);
    if (!m) return;
    const offset = m[0].charAt(0) === '!' ? 2 : 1;
    if (this.hasUnclosedTag(src, m[1], offset)) return;
    const ref = links[normalizeLabel(m[2] || m[1])];
    if (!ref) {
      const ch = m[0].charAt(0);
      return { type: 'text', raw: ch, text: ch };
    }
    return this.makeLink(m, ref, m[0]);
  }

  emStrong(src, masked, prevChar) {
    const s = DELIM.lDelim.exec(src);
    if (!s || (!s[1] && !s[2] && !s[3] && !s[4])) return;
    const delim = s[0][0];
    const prevIsSame = prevChar === delim;
    const i = masked.length - src.length; // start of src inside the masked text
    let l = i;
    while (l > 0 && masked[l - 1] === delim) l--;
    const beforeRun = l === 0 ? '' : masked[l - 1];
    const beforeIsPunct = beforeRun === '*' || beforeRun === '_' || !!RE.punctuation.exec(beforeRun);
    let prev = prevChar;
    if (l < i) prev = beforeRun;
    const prevIsPunct = l < i ? beforeIsPunct : !!RE.punctuation.exec(prev);
    if (s[4] && ALPHA_NUM.test(prev)) return;
    const afterPunct = s[1] || s[3] || '';
    if (!afterPunct || !prev || prevIsPunct) {
      const k = [...s[0]].length - 1; // opener run length
      let m = k, f = 0;
      const y = i - l + k;
      const canCloseOdd = !!beforeRun.trim() && (!!afterPunct || (delim === '*' && !beforeIsPunct));
      if (delim !== '*' && delim !== '_') return;
      const rDelim = delim === '*' ? DELIM.rDelimAst : DELIM.rDelimUnd;
      const last = delim === '*' ? this.lexer.emLast.star : this.lexer.emLast.und;
      const q = masked.length - src.length + k;
      if (last < q) return;
      const tail = masked.slice(q);
      const limit = last - q;
      let match;
      rDelim.lastIndex = 0;
      while ((match = rDelim.exec(tail)) !== null && !(match.index > limit)) {
        const g = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
        if (!g) continue;
        const b = [...g].length;
        if (match[3] || match[4]) { m += b; continue; }
        else if (match[5] || match[6] || canCloseOdd) {
          if (prevIsSame && (match[5] || match[6])) break;
          if (y % 3 !== 0 && (y + b) % 3 === 0) { f += b; continue; }
        }
        m -= b;
        if (m > 0) continue;
        const use = Math.min(b, b + m + f);
        const firstLen = [...match[0]][0].length;
        const whole = src.slice(0, k + match.index + firstLen + use);
        if (Math.min(k, use) % 2 === 1) {
          const inner = whole.slice(1, -1);
          return { type: 'em', raw: whole, text: inner, tokens: this.lexer.inlineTokens(inner) };
        }
        const inner = whole.slice(2, -2);
        return { type: 'strong', raw: whole, text: inner, tokens: this.lexer.inlineTokens(inner) };
      }
    }
  }

  codespan(src) {
    const m = RE.codeSpan.exec(src);
    if (!m) return;
    let text = m[2].replace(NEWLINE_GLOBAL, ' ');
    const hasNonSpace = NON_SPACE.test(text);
    const startsSpace = START_SPACE.test(text);
    const endsSpace = END_SPACE.test(text);
    if (hasNonSpace && startsSpace && endsSpace) text = text.substring(1, text.length - 1);
    return { type: 'codespan', raw: m[0], text };
  }

  br(src) {
    const m = RE.hardBreak.exec(src);
    if (m) return { type: 'br', raw: m[0] };
  }

  del(src, masked, prevChar) {
    const s = RE.delOpen.exec(src);
    if (!s) return;
    if (!(s[1] || '') || !prevChar || RE.punctuation.exec(prevChar)) {
      const k = [...s[0]].length - 1;
      let m = k;
      const rDelim = DELIM.rDelimDel;
      const last = this.lexer.emLast.del;
      const q = masked.length - src.length + k;
      if (last < q) return;
      const tail = masked.slice(q);
      const limit = last - q;
      let match;
      rDelim.lastIndex = 0;
      while ((match = rDelim.exec(tail)) !== null && !(match.index > limit)) {
        const g = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
        if (!g) continue;
        const b = [...g].length;
        if (b !== k) continue;
        if (match[3] || match[4]) { m += b; continue; }
        m -= b;
        if (m > 0) continue;
        const use = Math.min(b, b + m);
        const firstLen = [...match[0]][0].length;
        const whole = src.slice(0, k + match.index + firstLen + use);
        const inner = whole.slice(k, -k);
        return { type: 'del', raw: whole, text: inner, tokens: this.lexer.inlineTokens(inner) };
      }
    }
  }

  autolink(src) {
    const m = RE.autolink.exec(src);
    if (!m) return;
    let text, href;
    if (m[2] === '@') { text = m[1]; href = 'mailto:' + text; }
    else { text = m[1]; href = text; }
    return { type: 'link', raw: m[0], text, href, autolink: true, tokens: [{ type: 'text', raw: text, text }] };
  }

  url(src) {
    const m = RE.url.exec(src);
    if (!m) return;
    let text, href;
    // trim trailing punctuation the autolink rules exclude
    let raw = m[0];
    let prev;
    do {
      prev = raw;
      raw = RE.backpedal.exec(raw)?.[0] ?? '';
    } while (prev !== raw);
    if (m[2] === '@') { text = raw; href = 'mailto:' + raw; }
    else {
      if (m[1] === 'www.') href = 'http://' + raw;
      else href = raw;
      text = raw;
    }
    return { type: 'link', raw, text, href, autolink: true, tokens: [{ type: 'text', raw: text, text }] };
  }

}

// Mask code spans, links and HTML tags (and escaped punctuation) so emphasis
// delimiters inside them are invisible to the delimiter search. The masked
// text keeps the original length, so indices still line up.
function maskEmStrong(src, links, lexer) {
  let t = src;
  if (links && src.includes('[')) {
    const search = RE.refLinkSearch;
    const maskOne = (match) => {
      const o = match.lastIndexOf('[');
      if (!Object.hasOwn(links, normalizeLabel(match.slice(o + 1, -1)))) return match;
      if (o > 1 && match.charAt(0) !== '!') {
        const inner = match.slice(1, o - 1);
        if (lexer.linkInText(inner)) {
          return '[' + inner.replace(search, maskOne) + '][' + 'a'.repeat(match.length - o - 2) + ']';
        }
      }
      return '[' + 'a'.repeat(match.length - 2) + ']';
    };
    t = t.replace(search, maskOne);
  }
  // Each masking pass only runs when a character it could match is present.
  if (t.includes('\\') || t.includes('`')) {
    t = t.replace(RE.anyPunctOutsideCode, (n, s, r) =>
      r ? '+'.repeat(n.length) : s ? s + n.slice(s.length, -s.length).replace(/`/g, '+') + s : n);
  }
  if (t.includes('[') || t.includes('`') || t.includes('<')) {
    t = t.replace(RE.blockSkip, (n, s, r) => {
      const o = r ? r.length : 0;
      return n.slice(0, o) + '[' + 'a'.repeat(n.length - o - 2) + ']';
    });
  }
  return t;
}

// The inline pass, with the masked source for emphasis/delimiter matching.
// The last-possible-closer table is kept on a stack: inlineTokens recurses
// (emphasis content, link labels), and the nested call must not clobber the
// outer call's table — marked keeps the same stack discipline.
Lexer.prototype.inlineLoop = function (src, tokens) {
  const inline = this.inlineTokenizer || (this.inlineTokenizer = new InlineTokenizer(this));
  const needsMask = src.includes('*') || src.includes('_') || src.includes('~');
  const masked = needsMask ? maskEmStrong(src, this.tokens.links, this) : src;
  if (!this.emLastStack) this.emLastStack = [];
  this.emLastStack.push(needsMask ? lastPossibleClosers(masked) : { star: -1, und: -1, del: -1 });
  this.emLast = this.emLastStack[this.emLastStack.length - 1];
  let wasText = false;
  let prevChar = '';
  let prevLen = Infinity;
  while (src) {
    if (src.length < prevLen) prevLen = src.length;
    else throw new Error('Infinite loop on byte: ' + src.charCodeAt(0));
    if (!wasText) prevChar = '';
    wasText = false;
    let tok;
    const c = src[0];
    if (c === '\\' && (tok = inline.escape(src))) { src = src.substring(tok.raw.length); tokens.push(tok); continue; }
    if (c === '<' && (tok = inline.tag(src))) { src = src.substring(tok.raw.length); tokens.push(tok); continue; }
    if ((c === '[' || c === '!') && (tok = inline.link(src))) { src = src.substring(tok.raw.length); tokens.push(tok); continue; }
    if ((c === '[' || c === '!') && (tok = inline.reflink(src, this.tokens.links))) {
      src = src.substring(tok.raw.length);
      const prev = tokens.at(-1);
      if (tok.type === 'text' && prev && prev.type === 'text') { prev.raw += tok.raw; prev.text += tok.text; }
      else tokens.push(tok);
      continue;
    }
    if ((c === '*' || c === '_') && (tok = inline.emStrong(src, masked, prevChar))) { src = src.substring(tok.raw.length); tokens.push(tok); continue; }
    if (c === '`' && (tok = inline.codespan(src))) { src = src.substring(tok.raw.length); tokens.push(tok); continue; }
    if ((c === ' ' || c === '\\') && (tok = inline.br(src))) { src = src.substring(tok.raw.length); tokens.push(tok); continue; }
    if (c === '~' && (tok = inline.del(src, masked, prevChar))) { src = src.substring(tok.raw.length); tokens.push(tok); continue; }
    if (c === '<' && (tok = inline.autolink(src))) { src = src.substring(tok.raw.length); tokens.push(tok); continue; }
    if (!this.state.inLink && urlMayMatch(src) && (tok = inline.url(src))) { src = src.substring(tok.raw.length); tokens.push(tok); continue; }
    // plain text run (manual scan, no regex); a run that follows a text
    // token merges into it without allocating a token object of its own
    const end = scanTextEnd(src, 0);
    const raw = src.slice(0, end);
    src = src.substring(end);
    if (raw.slice(-1) !== '_') prevChar = raw.slice(-1);
    wasText = true;
    const inRaw = this.state.inRawBlock;
    const prev = tokens.at(-1);
    if (prev && prev.type === 'text') {
      prev.raw += raw;
      prev.text += inRaw ? raw : decodeEntities(raw);
    } else {
      tokens.push({ type: 'text', raw, text: inRaw ? raw : decodeEntities(raw), escaped: inRaw });
    }
  }
  this.emLastStack.pop();
  this.emLast = this.emLastStack[this.emLastStack.length - 1] || { star: -1, und: -1, del: -1 };
  return tokens;
};

// Does this inline source contain a link (used while masking)?
Lexer.prototype.linkInText = function (src) {
  if (!src.includes('[')) return false;
  for (const m of src.matchAll(RE.blockSkip)) {
    if (RE.link.test(m[0]) && src.charAt(m.index - 1) !== '!') return true;
  }
  for (const m of src.matchAll(RE.refLinkSearch)) {
    const s = m[0];
    const r = s.lastIndexOf('[');
    if (!(s.charAt(0) === '!' || !Object.hasOwn(this.tokens.links, normalizeLabel(s.slice(r + 1, -1)))) &&
        !(r > 1 && this.linkInText(s.slice(1, r - 1)))) return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Renderer (default marked 18.1.3 output, written from the observed behaviour)
// ---------------------------------------------------------------------------

class Renderer {
  space() { return ''; }

  code(token) {
    const lang = (token.lang || '').match(/^\S*/)[0];
    const body = token.text ? token.text.replace(/\n$/, '') + '\n' : '';
    const inner = token.escaped ? body : escapeHtml(body, true);
    if (lang) return '<pre><code class="language-' + escapeHtml(lang) + '">' + inner + '</code></pre>\n';
    return '<pre><code>' + inner + '</code></pre>\n';
  }

  blockquote(token) { return '<blockquote>\n' + this.parser.parse(token.tokens) + '</blockquote>\n'; }

  html(token) { return token.text; }

  def() { return ''; }

  heading(token) {
    return '<h' + token.depth + '>' + this.parser.parseInline(token.tokens) + '</h' + token.depth + '>\n';
  }

  hr() { return '<hr>\n'; }

  list(token) {
    let body = '';
    for (const item of token.items) body += this.listitem(item);
    const tag = token.ordered ? 'ol' : 'ul';
    const start = token.ordered && token.start !== 1 ? ' start="' + token.start + '"' : '';
    return '<' + tag + start + '>\n' + body + '</' + tag + '>\n';
  }

  listitem(token) { return '<li>' + this.parser.parse(token.tokens) + '</li>\n'; }

  checkbox(token) {
    return '<input ' + (token.checked ? 'checked="" ' : '') + 'disabled="" type="checkbox"> ';
  }

  paragraph(token) { return '<p>' + this.parser.parseInline(token.tokens) + '</p>\n'; }

  table(token) {
    let header = '';
    for (const cell of token.header) header += this.tablecell(cell);
    const headRow = this.tablerow({ text: header });
    let body = '';
    for (const row of token.rows) {
      let cells = '';
      for (const cell of row) cells += this.tablecell(cell);
      body += this.tablerow({ text: cells });
    }
    if (body) body = '<tbody>' + body + '</tbody>';
    return '<table>\n<thead>\n' + headRow + '</thead>\n' + body + '</table>\n';
  }

  tablerow(token) { return '<tr>\n' + token.text + '</tr>\n'; }

  tablecell(token) {
    const text = this.parser.parseInline(token.tokens);
    const tag = token.header ? 'th' : 'td';
    const open = token.align ? '<' + tag + ' align="' + token.align + '">' : '<' + tag + '>';
    return open + text + '</' + tag + '>\n';
  }

  strong(token) { return '<strong>' + this.parser.parseInline(token.tokens) + '</strong>'; }

  em(token) { return '<em>' + this.parser.parseInline(token.tokens) + '</em>'; }

  codespan(token) { return '<code>' + escapeHtml(token.text, true) + '</code>'; }

  br() { return '<br>'; }

  del(token) { return '<del>' + this.parser.parseInline(token.tokens) + '</del>'; }

  link(token) {
    const text = token.autolink ? escapeHtml(token.text, true) : this.parser.parseInline(token.tokens);
    const href = encodeHref(token.href);
    if (href === null) return text;
    const esc = escapeHtml(href, token.autolink);
    let out = '<a href="' + esc + '"';
    if (token.title) out += ' title="' + escapeHtml(token.title) + '"';
    return out + '>' + text + '</a>';
  }

  image(token) {
    let text = token.text;
    if (token.tokens) text = this.parser.parseInline(token.tokens, this.parser.textRenderer);
    const href = encodeHref(token.href);
    if (href === null) return escapeHtml(text);
    let out = '<img src="' + escapeHtml(href) + '" alt="' + escapeHtml(text) + '"';
    if (token.title) out += ' title="' + escapeHtml(token.title) + '"';
    return out + '>';
  }

  // A block-level text token renders its inline content bare (no <p> wrap);
  // an inline text token is escaped unless it came from a raw HTML block.
  text(token) {
    if (token.tokens) return this.parser.parseInline(token.tokens);
    if (token.escaped) return token.text;
    return escapeHtml(token.text);
  }
}

// Plain-text renderer used for image alt text: no markup, no escaping.
class TextRenderer {
  strong(token) { return token.tokens ? this.parser.parseInline(token.tokens, this) : token.text; }
  em(token) { return token.tokens ? this.parser.parseInline(token.tokens, this) : token.text; }
  codespan(token) { return token.text; }
  del(token) { return token.tokens ? this.parser.parseInline(token.tokens, this) : token.text; }
  html(token) { return token.text; }
  text(token) { return token.text; }
  link(token) { return token.tokens ? this.parser.parseInline(token.tokens, this) : token.text; }
  image(token) { return token.tokens ? this.parser.parseInline(token.tokens, this) : token.text; }
  br() { return ''; }
  checkbox(token) { return token.raw; }
}

class Parser {
  constructor() {
    this.renderer = new Renderer();
    this.textRenderer = new TextRenderer();
    this.renderer.parser = this;
    this.textRenderer.parser = this;
  }

  parse(tokens) {
    this.renderer.parser = this;
    let out = '';
    for (const token of tokens) {
      switch (token.type) {
        case 'space': out += this.renderer.space(token); break;
        case 'hr': out += this.renderer.hr(token); break;
        case 'heading': out += this.renderer.heading(token); break;
        case 'code': out += this.renderer.code(token); break;
        case 'table': out += this.renderer.table(token); break;
        case 'blockquote': out += this.renderer.blockquote(token); break;
        case 'list': out += this.renderer.list(token); break;
        case 'checkbox': out += this.renderer.checkbox(token); break;
        case 'html': out += this.renderer.html(token); break;
        case 'def': out += this.renderer.def(token); break;
        case 'paragraph': out += this.renderer.paragraph(token); break;
        case 'text': out += this.renderer.text(token); break;
        default: throw new Error('Token with "' + token.type + '" type was not found.');
      }
    }
    return out;
  }

  parseInline(tokens, renderer = this.renderer) {
    this.renderer.parser = this;
    let out = '';
    for (const token of tokens) {
      switch (token.type) {
        case 'escape': out += renderer.text(token); break;
        case 'html': out += renderer.html(token); break;
        case 'link': out += renderer.link(token); break;
        case 'image': out += renderer.image(token); break;
        case 'checkbox': out += renderer.checkbox(token); break;
        case 'strong': out += renderer.strong(token); break;
        case 'em': out += renderer.em(token); break;
        case 'codespan': out += renderer.codespan(token); break;
        case 'br': out += renderer.br(token); break;
        case 'del': out += renderer.del(token); break;
        case 'text': out += renderer.text(token); break;
        default: throw new Error('Token with "' + token.type + '" type was not found.');
      }
    }
    return out;
  }
}

// Public entry point: markdown string in, HTML string out, byte-identical to
// marked 18.1.3 with default options.
export function parse(markdown) {
  const tokens = new Lexer().lex(markdown);
  return new Parser().parse(tokens);
}
