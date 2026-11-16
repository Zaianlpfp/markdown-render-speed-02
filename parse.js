// markdown-render-speed-02 — single-pass index scanner.
// parse(markdown) returns exactly marked 18.1.3's HTML (default options).
// Architecture: one index-driven scan over lines for blocks (HTML emitted
// directly as each block is recognised; paragraphs are buffered as raw text
// and rendered at the end so forward link-reference definitions resolve),
// and one index-driven scan over inline text with a delimiter stack.
// No token tree, no AST, no second pass over a parsed structure.

// ---- named entities (HTML5 subset: Latin-1, Greek, common symbols) ----
const ENT = {
  quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ', iexcl: '¡', cent: '¢',
  pound: '£', curren: '¤', yen: '¥', brvbar: '¦', sect: '§', uml: '¨', copy: '©', ordf: 'ª',
  laquo: '«', not: '¬', shy: '­', reg: '®', macr: '¯', deg: '°', plusmn: '±', sup2: '²',
  sup3: '³', acute: '´', micro: 'µ', para: '¶', middot: '·', cedil: '¸', sup1: '¹', ordm: 'º',
  raquo: '»', frac14: '¼', frac12: '½', frac34: '¾', iquest: '¿', Agrave: 'À', Aacute: 'Á',
  Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È',
  Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï',
  ETH: 'Ð', Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö',
  times: '×', Oslash: 'Ø', Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü', Yacute: 'Ý',
  THORN: 'Þ', szlig: 'ß', agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä',
  aring: 'å', aelig: 'æ', ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë',
  igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï', eth: 'ð', ntilde: 'ñ', ograve: 'ò',
  oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', divide: '÷', oslash: 'ø', ugrave: 'ù',
  uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý', thorn: 'þ', yuml: 'ÿ',
  OElig: 'Œ', oelig: 'œ', Scaron: 'Š', scaron: 'š', Yuml: 'Ÿ', fnof: 'ƒ', circ: 'ˆ',
  tilde: '˜', ensp: ' ', emsp: ' ', thinsp: ' ', zwnj: '‌', zwj: '‍', lrm: '‎',
  rlm: '‏', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“',
  rdquo: '”', bdquo: '„', dagger: '†', Dagger: '‡', bull: '•', hellip: '…', permil: '‰',
  prime: '′', Prime: '″', lsaquo: '‹', rsaquo: '›', oline: '‾', frasl: '⁄', euro: '€',
  image: 'ℑ', weierp: '℘', real: 'ℜ', trade: '™', alefsym: 'ℵ', larr: '←', uarr: '↑',
  rarr: '→', darr: '↓', harr: '↔', crarr: '↵', lArr: '⇐', uArr: '⇑', rArr: '⇒', dArr: '⇓',
  hArr: '⇔', forall: '∀', part: '∂', exist: '∃', empty: '∅', nabla: '∇', isin: '∈',
  notin: '∉', ni: '∋', prod: '∏', sum: '∑', minus: '−', lowast: '∗', radic: '√',
  prop: '∝', infin: '∞', ang: '∠', and: '∧', or: '∨', cap: '∩', cup: '∪', int: '∫',
  there4: '∴', sim: '∼', cong: '≅', asymp: '≈', ne: '≠', equiv: '≡', le: '≤', ge: '≥',
  sub: '⊂', sup: '⊃', nsub: '⊄', sube: '⊆', supe: '⊇', oplus: '⊕', otimes: '⊗',
  perp: '⊥', sdot: '⋅', lceil: '⌈', rceil: '⌉', lfloor: '⌊', rfloor: '⌋', lang: '〈',
  rang: '〉', loz: '◊', spades: '♠', clubs: '♣', hearts: '♥', diams: '♦',
  Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Epsilon: 'Ε', Zeta: 'Ζ', Eta: 'Η',
  Theta: 'Θ', Iota: 'Ι', Kappa: 'Κ', Lambda: 'Λ', Mu: 'Μ', Nu: 'Ν', Xi: 'Ξ',
  Omicron: 'Ο', Pi: 'Π', Rho: 'Ρ', Sigma: 'Σ', Tau: 'Τ', Upsilon: 'Υ', Phi: 'Φ',
  Chi: 'Χ', Psi: 'Ψ', Omega: 'Ω', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ',
  mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', rho: 'ρ', sigmaf: 'ς', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', thetasym: 'ϑ',
  upsih: 'ϒ', piv: 'ϖ', Dcaron: 'Ď', dcaron: 'ď', Scaron2: 'Š', HilbertSpace: 'ℋ',
  DifferentialD: 'ⅆ', ClockwiseContourIntegral: '∲', ngE: '≧̸', check: '✓',
  cross: '✗', star: '★', phone: '☎', female: '♀', male: '♂', sun: '☀', cloud: '☁',
  snowman: '☃', comet: '☄', peace: '☮', anchor: '⚓', warning: '⚠', hot: '♨',
  hbar: 'ℏ', ell: 'ℓ', numero: '№', planck: 'ℎ', infin2: '∞', hearts2: '♥',
  copy2: '©', target: '◎', oelig2: 'œ', dagger2: '†', para2: '¶', sup4: '⁴',
  frac13: '⅓', frac23: '⅔', frac15: '⅕', frac25: '⅖', frac35: '⅗', frac45: '⅘',
  frac16: '⅙', frac56: '⅚', frac18: '⅛', frac38: '⅜', frac58: '⅝', frac78: '⅞',
  Atilde2: 'Ã', Ccedil2: 'Ç', Euml2: 'Ë', Ntilde2: 'Ñ', Ouml2: 'Ö', Uuml2: 'Ü',
  Yacute2: 'Ý', auml2: 'ä', euml2: 'ë', iuml2: 'ï', ouml2: 'ö', uuml2: 'ü',
  yuml2: 'ÿ', iexcl2: '¡', iquest2: '¿', laquo2: '«', raquo2: '»', sect2: '§',
  para3: '¶', middot2: '·', cedil2: '¸', sup12: '¹', sup22: '²', sup32: '³',
  acute2: '´', micro2: 'µ', deg2: '°', plusmn2: '±', times2: '×', divide2: '÷',
  minus2: '−', lowast2: '∗', radic2: '√', prop2: '∝', infin3: '∞', ang2: '∠',
  and2: '∧', or2: '∨', cap2: '∩', cup2: '∪', int2: '∫', there42: '∴', sim2: '∼',
  cong2: '≅', asymp2: '≈', ne2: '≠', equiv2: '≡', le2: '≤', ge2: '≥', sub2: '⊂',
  sup2b: '⊃', nsub2: '⊄', sube2: '⊆', supe2: '⊇', oplus2: '⊕', otimes2: '⊗',
  perp2: '⊥', sdot2: '⋅', lceil2: '⌈', rceil2: '⌉', lfloor2: '⌊', rfloor2: '⌋',
  lang2: '〈', rang2: '〉', loz2: '◊', spades2: '♠', clubs2: '♣', hearts3: '♥',
  diams2: '♦', ensp2: ' ', emsp2: ' ', thinsp2: ' ', zwnj2: '‌', zwj2: '‍',
  lrm2: '‎', rlm2: '‏', ndash2: '–', mdash2: '—', lsquo2: '‘', rsquo2: '’',
  sbquo2: '‚', ldquo2: '“', rdquo2: '”', bdquo2: '„', dagger3: '†', Dagger2: '‡',
  bull2: '•', hellip2: '…', permil2: '‰', prime2: '′', Prime2: '″', lsaquo2: '‹',
  rsaquo2: '›', oline2: '‾', frasl2: '⁄', euro2: '€', image2: 'ℑ', weierp2: '℘',
  real2: 'ℜ', trade2: '™', alefsym2: 'ℵ', larr2: '←', uarr2: '↑', rarr2: '→',
  darr2: '↓', harr2: '↔', crarr2: '↵', lArr2: '⇐', uArr2: '⇑', rArr2: '⇒',
  dArr2: '⇓', hArr2: '⇔', forall2: '∀', part2: '∂', exist2: '∃', empty2: '∅',
  nabla2: '∇', isin2: '∈', notin2: '∉', ni2: '∋', prod2: '∏', sum2: '∑',
};

// ---- small helpers ----
const PUNCT = new Set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~');
function esc(s) {
  let out = '', last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]; let r = 0;
    if (c === '&') r = '&amp;'; else if (c === '<') r = '&lt;'; else if (c === '>') r = '&gt;';
    else if (c === '"') r = '&quot;'; else if (c === "'") r = '&#39;';
    if (r) { out += s.slice(last, i) + r; last = i + 1; }
  }
  return last === 0 ? s : out + s.slice(last);
}
// Escape for code-span content: like esc(), but the escape entities
// (&lt; &gt; &amp; &quot; &#39; &#x27;) are preserved verbatim; other named
// entities are escaped (cm-035: &ouml; -> &amp;ouml;; doc-18: &lt; stays).
function escCode(s) {
  let out = '', last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]; let r = 0;
    if (c === '&') {
      const rest = s.slice(i + 1, i + 6);
      if (rest.startsWith('lt;') || rest.startsWith('gt;') || rest.startsWith('amp;') || rest.startsWith('quot;') || rest.startsWith('#39;') || rest.startsWith('#x27;')) continue; // entity: keep
      r = '&amp;';
    }
    else if (c === '<') r = '&lt;';
    else if (c === '>') r = '&gt;';
    else if (c === '"') r = '&quot;';
    else if (c === "'") r = '&#39;';
    if (r) { out += s.slice(last, i) + r; last = i + 1; }
  }
  return last === 0 ? s : out + s.slice(last);
}
function isSpace(ch) { return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v'; }
// Escape for hrefs/titles/alt/info: like esc(), but a valid named entity
// reference (&name;) is preserved verbatim.
function escAttr(s) {
  let out = '', last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]; let r = 0;
    if (c === '&') {
      let j = i + 1;
      while (j < s.length && j - i <= 32 && /[a-zA-Z0-9]/.test(s[j])) j++;
      if (j < s.length && s[j] === ';' && j > i + 1) continue; // entity reference: keep
      r = '&amp;';
    }
    else if (c === '<') r = '&lt;';
    else if (c === '>') r = '&gt;';
    else if (c === '"') r = '&quot;';
    else if (c === "'") r = '&#39;';
    if (r) { out += s.slice(last, i) + r; last = i + 1; }
  }
  return last === 0 ? s : out + s.slice(last);
}
// Decode only numeric entities (named ones stay verbatim in hrefs/titles).
function decodeNumeric(s) {
  if (!s.includes('&#')) return s;
  let out = '', last = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '&' && s[i + 1] === '#') {
      const e = tryEntity(s, i);
      if (e && e[2]) { out += s.slice(last, i) + e[0]; i += e[1] - 1; last = i + 1; }
    }
  }
  return last === 0 ? s : out + s.slice(last);
}
function isPunct(ch) { return ch !== undefined && PUNCT.has(ch); }
function isAlnum(ch) { return ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9')); }
function isUnicodePunct(ch) {
  if (ch === undefined) return false;
  if (isAlnum(ch) || isSpace(ch)) return false;
  // Unicode punctuation or symbol (approximation: non-letter, non-digit, non-space)
  return !/\p{L}|\p{N}/u.test(ch);
}
function isUnicodeSpace(ch) { return ch === undefined ? false : /\s/.test(ch); }

// Decode one entity starting at src[i] === '&'. Returns [text, length] or null.
// Named entities are returned verbatim (marked preserves them as written);
// numeric entities decode to the character when the code point is valid.
function tryEntity(src, i) {
  const n = src.length;
  if (src[i] !== '&' || i + 1 >= n) return null;
  if (src[i + 1] === '#') {
    let j = i + 2, hex = false;
    if (src[j] === 'x' || src[j] === 'X') { hex = true; j++; }
    let k = j;
    while (k < n && ((src[k] >= '0' && src[k] <= '9') || (hex && ((src[k] >= 'a' && src[k] <= 'f') || (src[k] >= 'A' && src[k] <= 'F'))))) k++;
    if (k === j || k >= n || src[k] !== ';') return null;
    let cp = parseInt(src.slice(j, k), hex ? 16 : 10);
    if (cp > 0x10FFFF) return null;
    if (!cp || (cp >= 0xD800 && cp <= 0xDFFF)) cp = 0xFFFD;
    return [String.fromCodePoint(cp), k - i + 1, true];
  }
  let j = i + 1;
  while (j < n && j - i <= 32 && /[a-zA-Z0-9]/.test(src[j])) j++;
  if (j >= n || src[j] !== ';') return null;
  return [src.slice(i, j + 1), j - i + 1, false];
}
// Decode entities in a URL/title/alt context: defined named entities and
// valid numeric entities decode; anything else is left as-is.
function decodeEntities(s) {
  if (!s.includes('&')) return s;
  let out = '', last = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '&') {
      if (s[i + 1] === '#') {
        const e = tryEntity(s, i);
        if (e) { out += s.slice(last, i) + e[0]; i += e[1] - 1; last = i + 1; }
      } else {
        let j = i + 1;
        while (j < s.length && j - i <= 32 && /[a-zA-Z0-9]/.test(s[j])) j++;
        if (j < s.length && s[j] === ';') {
          const v = ENT[s.slice(i + 1, j)];
          if (v !== undefined) { out += s.slice(last, i) + v; i = j; last = i + 1; }
        }
      }
    }
  }
  return last === 0 ? s : out + s.slice(last);
}
// marked's cleanUrl: block javascript:/vbscript:/data: (after entity+percent decoding)
// Percent-encode a URL href: the ASCII punctuation encodeURI encodes
// (" < > ` ^ { } | \ [ ]), plus non-ASCII as UTF-8. Existing '%' sequences
// and all other characters are left alone (encodeURI would double-encode
// '%' and break badges).
const HREF_ENCODE = { '"': '%22', '<': '%3C', '>': '%3E', '`': '%60', '^': '%5E', '{': '%7B', '}': '%7D', '|': '%7C', '\\': '%5C', '[': '%5B', ']': '%5D' };
function encodeHref(href) {
  let out = '';
  for (let k = 0; k < href.length; k++) {
    const c = href[k];
    const rep = HREF_ENCODE[c];
    if (rep) { out += rep; continue; }
    const code = href.charCodeAt(k);
    if (code > 127) {
      let ch = c;
      if (code >= 0xD800 && code <= 0xDBFF && k + 1 < href.length) {
        const lo = href.charCodeAt(k + 1);
        if (lo >= 0xDC00 && lo <= 0xDFFF) { ch = href.slice(k, k + 2); k++; }
      }
      out += encodeURIComponent(ch);
      continue;
    }
    out += c;
  }
  return out;
}
function cleanUrl(href) {
  if (href == null) return null;
  let probe;
  try {
    // A bare '%' (not a valid %XX escape) makes decodeURIComponent throw;
    // neutralise it so the scheme probe still runs.
    const safe = href.replace(/%(?![0-9a-fA-F]{2})/g, '%25');
    probe = decodeURIComponent(decodeEntities(safe)).replace(/[^a-zA-Z0-9:]/g, '').toLowerCase();
  } catch { return null; }
  if (probe.startsWith('javascript:') || probe.startsWith('vbscript:') || probe.startsWith('data:')) return null;
  return href;
}
function normalizeLabel(label) {
  // Unicode case folding: ẞ/ß fold to "ss" (cm-540)
  return label.replace(/\s+/g, ' ').trim().toLowerCase().replace(/ß/g, 'ss').replace(/ẞ/g, 'ss');
}
// Plain-text rendering of link text, for image alt attributes: render the
// inline markup, replace <img> with its alt, strip other tags, unescape.
function plainAlt(src, refs) {
  const html = renderInline(src, refs);
  let s = html.replace(/<img[^>]*?alt="([^"]*)"[^>]*?>/g, '$1');
  s = s.replace(/<[^>]*>/g, '');
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'");
  s = s.replace(/&#(\d+);/g, (m, n) => { const c = Number(n); return c > 0 && c <= 0x10FFFF ? String.fromCodePoint(c) : m; });
  s = s.replace(/&#[xX]([0-9a-fA-F]+);/g, (m, h) => { const c = parseInt(h, 16); return c > 0 && c <= 0x10FFFF ? String.fromCodePoint(c) : m; });
  return s;
}
// ---- inline: helpers ----
function findCodeEnd(src, i, ticks) {
  // src[i] is first backtick of opening run of `ticks`. Find a closing run
  // of exactly `ticks` backticks. Returns index of its first backtick or -1.
  const n = src.length;
  let j = i + ticks;
  while (j < n) {
    if (src[j] === '`') {
      let k = j;
      while (k < n && src[k] === '`') k++;
      if (k - j === ticks) return j;
      j = k;
    } else j++;
  }
  return -1;
}
// Match an inline HTML tag / comment / PI / declaration / CDATA at src[i]==='<'.
// Returns {text, len, name, closing, selfClose} or null.
function tryHtmlTag(src, i) {
  const n = src.length;
  if (src[i] !== '<') return null;
  // comment (<!--> and <!---> are complete empty comments, cm-626)
  if (src.startsWith('<!--', i)) {
    if (src.startsWith('<!-->', i)) return { text: '<!-->', len: 5, name: null, closing: false, selfClose: false };
    if (src.startsWith('<!--->', i)) return { text: '<!--->', len: 6, name: null, closing: false, selfClose: false };
    const end = src.indexOf('-->', i + 4);
    if (end === -1) return null;
    return { text: src.slice(i, end + 3), len: end + 3 - i, name: null, closing: false, selfClose: false };
  }
  if (src.startsWith('<?', i)) {
    const end = src.indexOf('?>', i + 2);
    if (end === -1) return null;
    return { text: src.slice(i, end + 2), len: end + 2 - i, name: null, closing: false, selfClose: false };
  }
  if (src.startsWith('<![CDATA[', i)) {
    const end = src.indexOf(']]>', i + 9);
    if (end === -1) return null;
    return { text: src.slice(i, end + 3), len: end + 3 - i, name: null, closing: false, selfClose: false };
  }
  if (src.startsWith('<!', i) && i + 2 < n && /[a-zA-Z]/.test(src[i + 2])) {
    const end = src.indexOf('>', i + 2);
    if (end === -1) return null;
    return { text: src.slice(i, end + 1), len: end + 1 - i, name: null, closing: false, selfClose: false };
  }
  // open or close tag
  let j = i + 1, closing = false;
  if (src[j] === '/') { closing = true; j++; }
  if (j >= n || !/[a-zA-Z]/.test(src[j])) return null;
  const nameStart = j;
  while (j < n && /[a-zA-Z0-9-]/.test(src[j])) j++;
  const name = src.slice(nameStart, j).toLowerCase();
  // Tag name must be followed by whitespace, '/', or '>' (cm-609: <m:abc>).
  if (j < n && src[j] !== ' ' && src[j] !== '\t' && src[j] !== '\n' && src[j] !== '>' && src[j] !== '/') return null;
  // Closing tags take no attributes (cm-624: </a href="foo">).
  if (closing) {
    while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n')) j++;
    if (j < n && src[j] === '>') return { text: src.slice(i, j + 1), len: j + 1 - i, name, closing, selfClose: false };
    return null;
  }
  // attributes
  while (j < n) {
    const c = src[j];
    if (c === '>') {
      return { text: src.slice(i, j + 1), len: j + 1 - i, name, closing, selfClose: false };
    }
    if (c === '/' && src[j + 1] === '>') {
      return { text: src.slice(i, j + 2), len: j + 2 - i, name, closing, selfClose: true };
    }
    if (c === ' ' || c === '\t' || c === '\n') { j++; continue; }
    // attribute name
    if (!/[a-zA-Z_:]/.test(c) && c !== '[' && c !== ']') return null;
    while (j < n && /[a-zA-Z0-9_.:-]/.test(src[j])) j++;
    while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n')) j++;
    if (src[j] === '=') {
      j++;
      while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\n')) j++;
      if (src[j] === '"' || src[j] === "'") {
        const q = src[j]; j++;
        while (j < n && src[j] !== q) j++;
        if (j >= n) return null;
        j++;
        // After a quoted value must come whitespace, '/', or '>' (cm-622).
        if (j < n && src[j] !== ' ' && src[j] !== '\t' && src[j] !== '\n' && src[j] !== '>' && src[j] !== '/') return null;
      } else {
        if (j >= n || src[j] === '>' || src[j] === '"' || src[j] === "'" || src[j] === '=' || src[j] === '<' || src[j] === '`') return null;
        // Unquoted values may not contain " ' = < > ` (cm-620).
        while (j < n && !isSpace(src[j]) && src[j] !== '>') {
          if (src[j] === '"' || src[j] === "'" || src[j] === '=' || src[j] === '<' || src[j] === '`') return null;
          j++;
        }
      }
    }
  }
  return null;
}
// <scheme:...> or <email> autolink at src[i]==='<'. Returns {href, text, len} or null.
function tryAutolink(src, i) {
  const n = src.length;
  const end = src.indexOf('>', i + 1);
  if (end === -1 || end - i > 320) return null;
  const inner = src.slice(i + 1, end);
  if (inner.includes('<') || inner.includes('\n') || inner.includes(' ') || inner === '') return null;
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]{1,31}):([^ \x00-\x20<>]*)$/.exec(inner);
  if (m) return { href: encodeHref(decodeNumeric(inner)), text: decodeNumeric(inner), len: end - i + 1 };
  const em = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.exec(inner);
  if (em) return { href: 'mailto:' + decodeNumeric(inner), text: decodeNumeric(inner), len: end - i + 1 };
  return null;
}
// Extended autolink (GFM) starting at src[i]. prevOk: char before i qualifies.
// Returns {href, text, len} or null.
function tryExtAutolink(src, i, prevOk) {
  if (!prevOk) return null;
  const n = src.length;
  let start = -1, kind = 0; // 1 www, 2 scheme, 3 email
  if (src.startsWith('www.', i)) { start = i; kind = 1; }
  else {
    // scheme:// — scan forward for ://
    let j = i;
    if (j < n && /[a-zA-Z]/.test(src[j])) {
      j++;
      while (j < n && /[a-zA-Z0-9+.-]/.test(src[j]) && j - i < 32) j++;
      if (j - i >= 2 && src[j] === ':' && src[j + 1] === '/' && src[j + 2] === '/') { start = i; kind = 2; }
    }
    if (start === -1) {
      // scheme: (not ://) — e.g. mailto:foo@bar.baz, xmpp:foo@bar.baz/txt
      let j = i;
      if (j < n && /[a-zA-Z]/.test(src[j])) {
        j++;
        while (j < n && /[a-zA-Z0-9+.-]/.test(src[j]) && j - i < 32) j++;
        if (j - i >= 2 && src[j] === ':' && src[j + 1] !== '/') {
          let k = j + 1;
          let end = k;
          while (end < n && !isSpace(src[end]) && src[end] !== '<') end++;
          const cand = src.slice(i, end);
          const atIdx = cand.indexOf('@', j - i + 1);
          if (atIdx !== -1) {
            // XMPP resource: after the domain keep at most one /segment
            let d = atIdx + 1;
            while (d < cand.length && /[a-zA-Z0-9.-]/.test(cand[d])) d++;
            let dend = d;
            while (dend > atIdx + 1 && (cand[dend - 1] === '.' || cand[dend - 1] === '-')) dend--;
            // Trailing '-'/'_' after the domain: no autolink (gfm-633)
            if (cand[dend] === '-' || cand[dend] === '_') return null;
            let cut = dend;
            if (cand[cut] === '/') {
              let r = cut + 1;
              while (r < cand.length && !isSpace(cand[r]) && cand[r] !== '<' && cand[r] !== '/') r++;
              if (r > cut + 1) {
                cut = r;
                if (cand[cut] === '@') {
                  let a = cut + 1;
                  while (a < cand.length && /[a-zA-Z0-9.-]/.test(cand[a])) a++;
                  let aend = a;
                  while (aend > cut + 1 && (cand[aend - 1] === '.' || cand[aend - 1] === '-')) aend--;
                  if (aend > cut + 1) cut = aend;
                }
              }
            }
            let text = cand.slice(0, cut);
            // trim trailing punctuation
            while (text.length > 0) {
              const last = text[text.length - 1];
              if (last === '?' || last === '!' || last === '.' || last === ',' || last === ':' || last === '*' || last === '_' || last === '~') { text = text.slice(0, -1); continue; }
              break;
            }
            if (text.length > j - i + 1) {
              return { href: encodeHref(decodeNumeric(text)), text: decodeNumeric(text), len: text.length };
            }
          }
        }
      }
      // email: local part starting at i
      j = i;
      while (j < n && /[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]/.test(src[j])) j++;
      if (j > i && j < n && src[j] === '@') {
        // domain: labels with dots, last label >= 2 letters
        let k = j + 1, lastDot = -1, ok = false;
        while (k < n && /[a-zA-Z0-9.-]/.test(src[k])) {
          if (src[k] === '.') lastDot = k;
          k++;
        }
        // trim trailing dots / punctuation from domain scan
        let dend = k;
        while (dend > j + 1 && (src[dend - 1] === '.' || src[dend - 1] === '-' )) dend--;
        // A trailing '-' or '_' means the address continues as a longer
        // identifier: no autolink at all (gfm-632).
        if (dend < n && (src[dend] === '-' || src[dend] === '_')) return null;
        // last dot within the trimmed domain (not a trimmed trailing dot)
        lastDot = -1;
        for (let q = j + 1; q < dend; q++) if (src[q] === '.') lastDot = q;
        if (lastDot > j + 1 && lastDot < dend) {
          const tld = src.slice(lastDot + 1, dend);
          if (/^[a-zA-Z]+$/.test(tld) && /[a-zA-Z0-9]/.test(src[j + 1])) {
            // domain labels valid?
            const dom = src.slice(j + 1, dend);
            if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(dom)) {
              return { href: 'mailto:' + decodeNumeric(src.slice(i, dend)), text: decodeNumeric(src.slice(i, dend)), len: dend - i };
            }
          }
        }
        return null;
      }
      return null;
    }
  }
  // scan the URL: until whitespace or '<'
  let j = start;
  while (j < n && !isSpace(src[j]) && src[j] !== '<') j++;
  let text = src.slice(start, j);
  // trim trailing punctuation
  let trim = 0;
  // balanced parens: trim trailing ')' while more closes than opens
  {
    let opens = 0, closes = 0;
    for (let k = 0; k < text.length; k++) { if (text[k] === '(') opens++; else if (text[k] === ')') closes++; }
    while (text.length > 0) {
      const last = text[text.length - 1];
      if (last === ')' && closes > opens) { text = text.slice(0, -1); closes--; trim++; continue; }
      if (last === '?' || last === '!' || last === '.' || last === ',' || last === ':' || last === '*' || last === '_' || last === '~') { text = text.slice(0, -1); trim++; continue; }
      if (last === ';') {
        const amp = text.lastIndexOf('&');
        if (amp !== -1 && /^[a-zA-Z0-9]+$/.test(text.slice(amp + 1, -1))) { trim += text.length - amp; text = text.slice(0, amp); continue; }
        break;
      }
      break;
    }
  }
  if (text === '' || (kind === 1 && text === 'www.')) return null;
  const href = kind === 1 ? 'http://' + text : text;
  return { href: encodeHref(decodeNumeric(href)), text: decodeNumeric(text), len: text.length };
}
function extPrevOk(src, i) {
  if (i === 0) return true;
  const p = src[i - 1];
  return isSpace(p) || p === '(' || p === '*' || p === '_' || p === '~' || p === '<';
}

// ---- inline scanner ----
function renderInline(src, refs) {
  const out = [];
  const delims = []; // {ch, start, len, open, close, active, tilde}
  const linkSpans = []; // {open, close} indices into out
  const n = src.length;
  let i = 0;
  let openBrackets = 0; // active '[' openers (cached; autolinks suppressed inside link text)
  let rawTag = null; // inside <pre>/<code>/<kbd>/<script>
  while (i < n) {
    const c = src[i];
    if (rawTag) {
      // literal until the matching close tag
      const closeRe = new RegExp('</' + rawTag + '(?:[ \\t\\n>]|$)', 'i');
      const rest = src.slice(i);
      const m = closeRe.exec(rest);
      if (!m) { out.push(esc(src.slice(i))); i = n; }
      else {
        if (m.index > 0) out.push(esc(src.slice(i, i + m.index)));
        i += m.index;
        rawTag = null;
        continue; // reprocess the close tag normally
      }
      continue;
    }
    if (c === '\\') {
      if (i + 1 < n && PUNCT.has(src[i + 1])) { out.push(esc(src[i + 1])); i += 2; continue; }
      if (i + 1 < n && src[i + 1] === '\n') { out.push('<br>'); i += 2; while (i < n && (src[i] === ' ' || src[i] === '\t')) i++; continue; }
      out.push('\\'); i++; continue;
    }
    if (c === '`') {
      let j = i;
      while (j < n && src[j] === '`') j++;
      const ticks = j - i;
      const end = findCodeEnd(src, i, ticks);
      if (end === -1) { out.push(src.slice(i, j)); i = j; continue; }
      let content = src.slice(j, end).replace(/\r\n?|\n/g, ' ');
      if (content.length >= 2 && content[0] === ' ' && content[content.length - 1] === ' ' && /[^ ]/.test(content)) {
        content = content.slice(1, -1);
      }
      out.push('<code>' + escCode(content) + '</code>');
      i = end + ticks;
      continue;
    }
    if (c === '&') {
      const e = tryEntity(src, i);
      if (e) { out.push(e[2] ? esc(e[0]) : e[0]); i += e[1]; continue; }
      out.push('&amp;'); i++; continue;
    }
    if (c === '*' || c === '_' || c === '~') {
      let j = i;
      while (j < n && src[j] === c) j++;
      const len = j - i;
      // Strikethrough: runs of 1-2 tildes are delimiters; 3+ are literal.
      if (c === '~' && len > 2) { for (let k = 0; k < len; k++) out.push('~'); i = j; continue; }
      const before = i === 0 ? undefined : src[i - 1];
      const after = j >= n ? undefined : src[j];
      // Flanking: a boundary counts as neither space nor punctuation for
      // condition (1), but DOES satisfy the (2b) "whitespace or punctuation"
      // side (so `*-*` closes at end-of-input, cm-056, and `*foo**bar`
      // still obeys the rule of 3, cm-411).
      const bSpace = before !== undefined && isUnicodeSpace(before), bPunct = before !== undefined && isUnicodePunct(before);
      const aSpace = after !== undefined && isUnicodeSpace(after), aPunct = after !== undefined && isUnicodePunct(after);
      const bSide = before === undefined || bSpace || bPunct;
      const aSide = after === undefined || aSpace || aPunct;
      const leftFlank = !aSpace && (!aPunct || bSide);
      const rightFlank = !bSpace && (!bPunct || aSide);
      let canOpen, canClose;
      if (c === '*') { canOpen = leftFlank; canClose = rightFlank; }
      else if (c === '_') {
        // A boundary counts as punctuation for the `_` open/close rules
        // (so `_foo bar_` opens at the start, cm-357), while flanking
        // itself treats it as neither space nor punctuation (cm-411).
        canOpen = leftFlank && (!rightFlank || before === undefined || isUnicodePunct(before));
        canClose = rightFlank && (!leftFlank || after === undefined || isUnicodePunct(after));
      } else { canOpen = leftFlank; canClose = rightFlank; }
      const start = out.length;
      for (let k = 0; k < len; k++) out.push(c);
      delims.push({ ch: c, start, len, open: canOpen, close: canClose, active: true, tilde: c === '~' });
      i = j;
      continue;
    }
    if (c === '[') {
      const start = out.length;
      out.push('[');
      delims.push({ ch: '[', start, len: 1, open: true, close: false, active: true, tilde: false, image: false, bangPos: -1, srcPos: i });
      openBrackets++;
      i++;
      continue;
    }
    if (c === '!' && src[i + 1] === '[') {
      const start = out.length;
      out.push('!');
      const bstart = out.length;
      out.push('[');
      delims.push({ ch: '[', start: bstart, len: 1, open: true, close: false, active: true, tilde: false, image: true, bangPos: start, srcPos: i + 1 });
      openBrackets++;
      i += 2;
      continue;
    }
    if (c === ']') {
      const ce = closeLink(src, i, out, delims, linkSpans, refs);
      openBrackets = 0;
      for (let q = 0; q < delims.length; q++) if (delims[q].ch === '[' && delims[q].active) openBrackets++;
      if (ce >= 0) { i = ce; continue; }
      out.push(']'); i++; continue;
    }
    if (c === '<') {
      {
        const al = tryAutolink(src, i);
        if (al) { out.push('<a href="' + escAttr(al.href) + '">' + escAttr(al.text) + '</a>'); i += al.len; continue; }
      }
      const tag = tryHtmlTag(src, i);
      if (tag) {
        out.push(disallowedTag(tag));
        if (!tag.closing && !tag.selfClose && tag.name && (tag.name === 'pre' || tag.name === 'code' || tag.name === 'kbd' || tag.name === 'script')) rawTag = tag.name;
        if (tag.closing && rawTag && tag.name === rawTag) rawTag = null;
        i += tag.len;
        continue;
      }
      out.push('&lt;'); i++; continue;
    }
    if (c === '\n') {
      // hard break if the line ends with 2+ spaces
      const lastEl = out[out.length - 1];
      let spaces = 0;
      if (typeof lastEl === 'string') {
        let k = lastEl.length - 1;
        while (k >= 0 && lastEl[k] === ' ') { spaces++; k--; }
        if (spaces >= 2) out[out.length - 1] = lastEl.slice(0, lastEl.length - spaces);
      }
      out.push(spaces >= 2 ? '<br>' : '\n');
      i++;
      // After a hard break, leading whitespace of the next line is stripped.
      if (spaces >= 2) while (i < n && (src[i] === ' ' || src[i] === '\t')) i++;
      continue;
    }
    // plain text run (with mid-run extended autolink detection)
    {
      const runStart = i;
      let j = i;
      while (j < n) {
        const ch = src[j];
        if (ch === '\\' || ch === '&' || ch === '`' || ch === '*' || ch === '~' || ch === '[' || ch === ']' || ch === '!' || ch === '<' || ch === '\n') break;
        // Intraword '_' can never be emphasis: keep it in the run so an
        // email local part is not split (gfm-632).
        if (ch === '_' && j > runStart && j + 1 < n && /[a-zA-Z0-9]/.test(src[j - 1]) && /[a-zA-Z0-9]/.test(src[j + 1])) { j++; continue; }
        if (ch === '_') break;
        // extended autolink start? (autolinks DO form inside link text)
        {
          if (ch === 'w' && src.startsWith('www.', j) && extPrevOk(src, j)) break;
          if (ch === '@') {
            // email starting earlier in this run?
            let ls = j - 1;
            while (ls >= runStart && /[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]/.test(src[ls])) ls--;
            ls++;
            if (ls < j && extPrevOk(src, ls) && tryExtAutolink(src, ls, true)) { j = ls; break; }
          }
          if (ch === ':') {
            let ls = j - 1;
            while (ls >= runStart && /[a-zA-Z0-9+.-]/.test(src[ls])) ls--;
            ls++;
            if (ls < j && src.slice(ls, j).length >= 2 && /[a-zA-Z]/.test(src[ls]) && extPrevOk(src, ls)) {
              if (src[j + 1] === '/' && src[j + 2] === '/') { j = ls; break; }
              // scheme: + email-like content (mailto:, xmpp:) — break if an
              // '@' appears before the next whitespace
              let q = j + 1;
              while (q < n && !isSpace(src[q]) && src[q] !== '<') { if (src[q] === '@') { j = ls; break; } q++; }
              if (j === ls) break;
            }
          }
        }
        j++;
      }
      if (j > i) {
        out.push(escPlain(src.slice(i, j)));
        i = j;
        continue;
      }
      // extended autolink at i
      {
        const ea = tryExtAutolink(src, i, extPrevOk(src, i));
        if (ea) { out.push('<a href="' + escAttr(ea.href) + '">' + escAttr(ea.text) + '</a>'); i += ea.len; continue; }
      }
      // single char fallback (shouldn't normally happen)
      out.push(escPlain(src[i])); i++;
    }
  }
  processEmphasis(delims, out, linkSpans);
  return out.join('');
}
function escPlain(s) {
  // text run without & or < (those are handled separately); escape > " '
  let out = '', last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]; let r = 0;
    if (c === '>') r = '&gt;'; else if (c === '"') r = '&quot;'; else if (c === "'") r = '&#39;';
    if (r) { out += s.slice(last, i) + r; last = i + 1; }
  }
  return last === 0 ? s : out + s.slice(last);
}
const DISALLOWED = new Set(['title', 'textarea', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'script', 'plaintext']);
function disallowedTag(tag) {
  // DISALLOWED only bars these tags from starting an HTML block (type 6);
  // as inline HTML they render raw (gfm-657).
  return tag.text;
}
// ---- inline: link parsing ----
function resolveEscapes(s) {
  if (!s.includes('\\')) return s;
  let out = '', i = 0;
  while (i < s.length) {
    if (s[i] === '\\' && i + 1 < s.length && PUNCT.has(s[i + 1])) { out += s[i + 1]; i += 2; }
    else { out += s[i]; i++; }
  }
  return out;
}
function parseTitle(src, j) {
  const n = src.length;
  const q = src[j];
  if (q === '"' || q === "'") {
    let k = j + 1;
    while (k < n) {
      if (src[k] === '\\' && k + 1 < n) { k += 2; continue; }
      if (src[k] === q) return { title: decodeNumeric(resolveEscapes(src.slice(j + 1, k))), end: k + 1 };
      k++;
    }
    return null;
  }
  if (q === '(') {
    let k = j + 1, depth = 1;
    while (k < n) {
      if (src[k] === '\\' && k + 1 < n) { k += 2; continue; }
      if (src[k] === '(') depth++;
      else if (src[k] === ')') { depth--; if (depth === 0) return { title: decodeNumeric(resolveEscapes(src.slice(j + 1, k))), end: k + 1 }; }
      k++;
    }
    return null;
  }
  return null;
}
// Parse an inline link starting at src[i]==='('. Returns {href,title,end} or null.
function parseInlineLink(src, i) {
  const n = src.length;
  let j = i + 1;
  while (j < n && isSpace(src[j])) j++;
  if (j >= n) return null;
  let dest;
  if (src[j] === '<') {
    let k = j + 1, ok = false;
    while (k < n) {
      if (src[k] === '\\' && k + 1 < n) { k += 2; continue; }
      if (src[k] === '<' || src[k] === '\n') break;
      if (src[k] === '>') { ok = true; break; }
      k++;
    }
    if (!ok) return null;
    dest = src.slice(j + 1, k);
    j = k + 1;
  } else {
    let k = j, depth = 0;
    while (k < n) {
      const ch = src[k];
      if (ch === '\\' && k + 1 < n && PUNCT.has(src[k + 1])) { k += 2; continue; }
      if (isSpace(ch) || ch === '<') break;
      if (ch === '(') { depth++; k++; continue; }
      if (ch === ')') { if (depth === 0) break; depth--; k++; continue; }
      if (ch.charCodeAt(0) < 0x20) break;
      k++;
    }
    if (k === j) { if (src[j] === ')') dest = ''; else return null; }
    else dest = src.slice(j, k);
    j = k;
  }
  dest = encodeHref(decodeNumeric(resolveEscapes(dest)));
  let title = null;
  const saveJ = j;
  while (j < n && isSpace(src[j])) j++;
  if (j < n && (src[j] === '"' || src[j] === "'" || src[j] === '(')) {
    const t = parseTitle(src, j);
    if (t) { title = t.title; j = t.end; while (j < n && isSpace(src[j])) j++; }
    else j = saveJ;
  }
  if (j >= n || src[j] !== ')') return null;
  return { href: dest, title, end: j + 1 };
}
// Find the label end: src[i]==='['; scan to matching ']' (balanced, escapes ok).
// Returns index of ']' or -1.
function findLabelEnd(src, i) {
  const n = src.length;
  let depth = 0;
  for (let k = i + 1; k < n; k++) {
    const ch = src[k];
    if (ch === '\\' && k + 1 < n) { k++; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') { if (depth === 0) return k; depth--; }
    else if (ch === '\n') { /* labels may span lines but not blank lines; \n\n can't occur in a paragraph */ }
  }
  return -1;
}
// Label end for link LABELS (definitions and reference labels): the FIRST
// ']' (no nesting) — a label containing an unescaped '[' is invalid
// (cm-547/cm-548/cm-590). Returns index of ']' or -1.
function findLabelEndSimple(src, i) {
  const n = src.length;
  for (let k = i + 1; k < n; k++) {
    const ch = src[k];
    if (ch === '\\' && k + 1 < n) { k++; continue; }
    if (ch === ']') return k;
  }
  return -1;
}
// Try to close a link at src[i]===']'. Returns end index on success, -1 on failure.
function closeLink(src, i, out, delims, linkSpans, refs) {
  // most recent active '[' opener
  let oi = -1;
  for (let k = delims.length - 1; k >= 0; k--) {
    if (delims[k].ch === '[' && delims[k].active) { oi = k; break; }
  }
  if (oi === -1) return -1;
  const opener = delims[oi];
  const rawText = src.slice(opener.srcPos + 1, i);
  const n = src.length;
  let href = null, title = null, end = -1;
  // 1. inline link
  if (i + 1 < n && src[i + 1] === '(') {
    const il = parseInlineLink(src, i + 1);
    if (il) {
      if (cleanUrl(il.href) === null) { opener.active = false; return -1; }
      href = il.href; title = il.title; end = il.end;
    }
  }
  // 2. full / collapsed / shortcut reference
  if (href === null) {
    let bracketFollows = false;
    if (i + 1 < n && src[i + 1] === '[') {
      const le = findLabelEndSimple(src, i + 1);
      if (le !== -1) {
        bracketFollows = true;
        const label = src.slice(i + 2, le);
        const key = normalizeLabel(label === '' ? rawText : label);
        const def = refs.get(key);
        if (def) { href = def.href; title = def.title; end = le + 1; }
      }
    }
    // No shortcut fallback when a [...] label follows: a failed full
    // reference leaves the text literal (cm-571).
    if (href === null && !bracketFollows) {
      // shortcut: label is the link text itself
      const def = refs.get(normalizeLabel(rawText));
      if (def) { href = def.href; title = def.title; end = i + 1; }
    }
  }
  if (href === null) { opener.active = false; return -1; }
  // A link cannot contain a link: deactivate all non-image '[' openers at
  // or before this one. Images do NOT do this: an image's alt text may
  // contain a link (rendered as plain text in the alt, cm-575).
  if (!opener.image) {
    for (let k = 0; k <= oi; k++) if (delims[k].ch === '[' && !delims[k].image) delims[k].active = false;
  }
  href = href.replace(/ /g, '%20');
  if (opener.image) {
    opener.active = false;
    // remove the rendered link text from out, replace with <img>
    for (let k = 0; k < delims.length; k++) {
      if (delims[k].start > opener.start) delims[k].active = false;
    }
    out.length = opener.start;
    out.push('<img src="' + escAttr(href) + '" alt="' + escAttr(plainAlt(rawText, refs)) + '"' + (title != null ? ' title="' + escAttr(title) + '"' : '') + '>');
    out[opener.bangPos] = '';
    return end;
  }
  out[opener.start] = '<a href="' + escAttr(href) + '"' + (title != null ? ' title="' + escAttr(title) + '"' : '') + '>';
  out.push('</a>');
  linkSpans.push({ open: opener.start, close: out.length - 1 });
  return end;
}
// ---- inline: emphasis resolution ----
function spanAt(pos, linkSpans) {
  for (let s = 0; s < linkSpans.length; s++) {
    const sp = linkSpans[s];
    if (pos > sp.open && pos < sp.close) return sp;
  }
  return null;
}
function processEmphasis(delims, out, linkSpans) {
  const bottom = { '*': -1, '_': -1, '~': -1 };
  const emSpans = [];
  for (let ci = 0; ci < delims.length; ci++) {
    const closer = delims[ci];
    if (!closer.active || !closer.close || closer.ch === '[') continue;
    const ch = closer.ch;
    while (closer.active && closer.close && closer.len > 0) {
      let oi = ci - 1, opener = null;
      while (oi > bottom[ch]) {
        const cand = delims[oi];
        if (cand.ch === ch && cand.active && cand.open && !cand.tilde === !closer.tilde) {
          // rule of 3 (allowed when both lengths are multiples of 3, and
          // when the pair spans the whole delimiter list — otherwise the
          // only possible match would be stranded, cm-442/cm-443)
          if (cand.close && closer.open && (cand.len + closer.len) % 3 === 0 && (cand.len % 3 !== 0 || closer.len % 3 !== 0) && !(oi === 0 && ci === delims.length - 1)) { oi--; continue; }
          // link/emphasis boundary: opener and closer must be in the same
          // container (both outside, or both inside the same link/emphasis
          // span); a match may not cross a span boundary (cm-469/470/473/474)
          const os = spanAt(cand.start, linkSpans), cs = spanAt(closer.start, linkSpans);
          const oe = spanAt(cand.start, emSpans), ce = spanAt(closer.start, emSpans);
          if (os !== cs || oe !== ce) { oi--; continue; }
          opener = cand;
          break;
        }
        oi--;
      }
      if (!opener) { if (!closer.open) bottom[ch] = ci; break; }
      const use = (opener.len >= 2 && closer.len >= 2 ? 2 : 1);
      const openTag = closer.tilde ? '<del>' : (use === 2 ? '<strong>' : '<em>');
      const closeTag = closer.tilde ? '</del>' : (use === 2 ? '</strong>' : '</em>');
      // opener: consume `use` from the RIGHT of the remaining run, so a
      // later (outer) match lands left of an earlier (inner) one (cm-413).
      const oPos = opener.start + opener.len - use;
      out[oPos] = openTag;
      for (let k = 1; k < use; k++) out[oPos + k] = '';
      opener.len -= use;
      if (opener.len === 0) opener.active = false;
      emSpans.push({ open: oPos, close: closer.start });
      // closer: consume `use` from the left; if closer is inside a link the
      // opener is outside of, the close tag goes after the link's </a>
      const cs = spanAt(closer.start, linkSpans);
      const os = spanAt(oPos, linkSpans);
      if (cs && !os) {
        for (let k = 0; k < use; k++) out[closer.start + k] = '';
        out[cs.close] += closeTag;
      } else {
        out[closer.start] = closeTag;
        for (let k = 1; k < use; k++) out[closer.start + k] = '';
      }
      closer.start += use; closer.len -= use;
      if (closer.len === 0) closer.active = false;
    }
  }
}
// ---- block helpers ----
function indentInfo(line) {
  let col = 0, idx = 0;
  while (idx < line.length) {
    const ch = line[idx];
    if (ch === ' ') { col++; idx++; }
    else if (ch === '\t') { col += 4 - (col % 4); idx++; }
    else break;
  }
  return { col, idx };
}
function blank(line) {
  for (let i = 0; i < line.length; i++) if (line[i] !== ' ' && line[i] !== '\t') return false;
  return true;
}
// Strip exactly n columns from the front of a line (any chars count;
// a tab straddling the boundary becomes spaces). For list item lines,
// where the marker occupies columns.
function stripPrefix(line, n) {
  let col = 0, idx = 0;
  while (idx < line.length && col < n) {
    const ch = line[idx];
    if (ch === '\t') { const nx = col + (4 - (col % 4)); if (nx > n) return ' '.repeat(nx - n) + line.slice(idx + 1); col = nx; idx++; }
    else { col++; idx++; }
  }
  return line.slice(idx);
}
function stripCols(line, n) {
  let col = 0, idx = 0;
  while (idx < line.length && col < n) {
    const ch = line[idx];
    if (ch === ' ') { col++; idx++; }
    else if (ch === '\t') { const nx = col + (4 - (col % 4)); if (nx > n) return ' '.repeat(nx - n) + line.slice(idx + 1); col = nx; idx++; }
    else break;
  }
  return line.slice(idx);
}
// True if lines contain an unclosed fenced code block (a blank inside it
// belongs to the fence, not to the enclosing list).
function hasOpenFence(lines) {
  let fence = null;
  for (const l of lines) {
    const fs = fenceStart(l);
    if (!fence) { if (fs) fence = fs; continue; }
    if (fs && fs.ch === fence.ch && fs.len >= fence.len) fence = null;
  }
  return fence !== null;
}
function atxHeading(line) {
  const { col, idx } = indentInfo(line);
  if (col > 3) return null;
  let j = idx, hashes = 0;
  while (line[j] === '#') { hashes++; j++; }
  if (hashes === 0 || hashes > 6) return null;
  if (j < line.length && line[j] !== ' ' && line[j] !== '\t') return null;
  let content = line.slice(j).replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
  // closing sequence
  if (content.endsWith('#')) {
    let k = content.length;
    while (k > 0 && content[k - 1] === '#') k--;
    if (k === 0 || content[k - 1] === ' ' || content[k - 1] === '\t') {
      content = content.slice(0, k).replace(/[ \t]+$/, '');
    }
  }
  return { level: hashes, text: content };
}
// Fenced code start: returns {ch, len, info} or null
function fenceStart(line) {
  const { col, idx } = indentInfo(line);
  if (col > 3) return null;
  const ch = line[idx];
  if (ch !== '`' && ch !== '~') return null;
  let j = idx;
  while (line[j] === ch) j++;
  const len = j - idx;
  if (len < 3) return null;
  const info = line.slice(j);
  if (ch === '`' && info.includes('`')) return null;
  return { ch, len, info: info.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '') };
}
function isHR(line) {
  const { col, idx } = indentInfo(line);
  if (col > 3) return null;
  const ch = line[idx];
  if (ch !== '-' && ch !== '_' && ch !== '*') return null;
  let count = 0, j = idx;
  while (j < line.length) {
    if (line[j] === ch) { count++; j++; }
    else if (line[j] === ' ' || line[j] === '\t') j++;
    else return null;
  }
  return count >= 3 ? ch : null;
}
function setextLevel(line) {
  const { col, idx } = indentInfo(line);
  if (col > 3) return 0;
  const ch = line[idx];
  if (ch !== '=' && ch !== '-') return 0;
  let j = idx;
  while (line[j] === ch) j++;
  while (j < line.length && (line[j] === ' ' || line[j] === '\t')) j++;
  if (j !== line.length) return 0;
  return ch === '=' ? 1 : 2;
}
const BLOCK_TAGS = new Set(['address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center', 'col', 'colgroup', 'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem', 'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'section', 'source', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul']);
// HTML block start: returns type 1-7 or 0
function htmlBlockStart(line) {
  const { col, idx } = indentInfo(line);
  if (col > 3 || line[idx] !== '<') return 0;
  const rest = line.slice(idx);
  if (/^<(pre|script|style|textarea)(?:[ \t>]|$)/i.test(rest)) return 1;
  if (rest.startsWith('<!--')) return 2;
  if (rest.startsWith('<?')) return 3;
  if (/^<![a-zA-Z]/.test(rest)) return 4;
  if (rest.startsWith('<![CDATA[')) return 5;
  const m = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(rest);
  if (m) {
    const name = m[1].toLowerCase();
    const after = rest[m[0].length];
    if (BLOCK_TAGS.has(name) && (after === ' ' || after === '\t' || after === '>' || after === undefined)) return 6;
  }
  // Type 7: a complete open/close tag alone on the line (not pre/script/
  // style/textarea, which are type 1).
  const tag = tryHtmlTag(line, idx);
  if (tag && tag.name && !/^(pre|script|style|textarea)$/i.test(tag.name) && /^[ \t]*$/.test(line.slice(idx + tag.len))) return 7;
  return 0;
}
// List marker: returns {bullet, ordered, num, delim, contentCol} or null
function listMarker(line) {
  const { col, idx } = indentInfo(line);
  if (col > 3) return null;
  const ch = line[idx];
  if (ch === '-' || ch === '+' || ch === '*') {
    const after = line[idx + 1];
    if (after !== ' ' && after !== '\t' && after !== undefined) return null;
    const cc = contentCol(line, idx + 1, col + 1);
    return { bullet: ch, ordered: false, num: 0, delim: '', contentCol: cc };
  }
  if (ch >= '0' && ch <= '9') {
    let j = idx;
    while (line[j] >= '0' && line[j] <= '9') j++;
    if (j - idx > 9) return null;
    const d = line[j];
    if (d !== '.' && d !== ')') return null;
    const after = line[j + 1];
    if (after !== ' ' && after !== '\t' && after !== undefined) return null;
    const num = parseInt(line.slice(idx, j), 10);
    const cc = contentCol(line, j + 1, col + (j - idx) + 1);
    return { bullet: '', ordered: true, num, delim: d, contentCol: cc };
  }
  return null;
}
// Column where list item content starts, given whitespace starts at string
// index `wsIdx` with virtual column `wsCol` (just after the marker).
function contentCol(line, wsIdx, wsCol) {
  if (wsIdx >= line.length) return wsCol + 1;
  let col = wsCol, j = wsIdx, spaces = 0;
  while (j < line.length && (line[j] === ' ' || line[j] === '\t')) {
    if (line[j] === ' ') { col++; spaces++; j++; }
    else { const nx = col + (4 - (col % 4)); spaces += nx - col; col = nx; j++; }
    if (spaces > 4) break;
  }
  if (spaces === 0) return wsCol + 1; // shouldn't happen (checked by caller)
  if (spaces >= 5) return wsCol + 1;
  return col;
}
// Table delimiter row: returns alignments array or null
function tableDelim(line) {
  const { col, idx } = indentInfo(line);
  if (col > 3) return null;
  let s = line.slice(idx).replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
  if (s === '') return null;
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells = s.split('|');
  const aligns = [];
  for (const cell of cells) {
    const t = cell.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
    if (!/^:?-+:?$/.test(t)) return null;
    aligns.push(t.startsWith(':') ? (t.endsWith(':') ? 'center' : 'left') : (t.endsWith(':') ? 'right' : null));
  }
  return aligns;
}
// Split a table row line into raw cell strings (keeps \| and code spans intact)
function splitTableRow(line) {
  let s = line.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '', i = 0;
  while (i < s.length) {
    const ch = s[i];
    // An escaped pipe is a literal pipe (backslash consumed by the split).
    if (ch === '\\' && i + 1 < s.length && s[i + 1] === '|') { cur += '|'; i += 2; continue; }
    if (ch === '\\' && i + 1 < s.length) { cur += s[i] + s[i + 1]; i += 2; continue; }
    if (ch === '`') {
      let j = i;
      while (j < s.length && s[j] === '`') j++;
      const ticks = j - i;
      const end = findCodeEnd(s, i, ticks);
      if (end === -1) { cur += s.slice(i); i = s.length; continue; }
      // An escaped pipe inside a code span is still a literal pipe.
      cur += s.slice(i, end + ticks).replace(/\\\|/g, '|');
      i = end + ticks;
      continue;
    }
    if (ch === '|') { cells.push(cur); cur = ''; i++; continue; }
    cur += ch; i++;
  }
  cells.push(cur);
  return cells.map(c => c.replace(/^[ \t]+/, '').replace(/[ \t]+$/, ''));
}
// Parse a link reference definition starting at lines[i].
// Returns {label, href, title, next} or null.
function tryDefinition(lines, i) {
  const first = lines[i];
  const { col, idx } = indentInfo(first);
  if (col > 3 || first[idx] !== '[') return null;
  const rest = lines.slice(i, i + 32).join('\n');
  const le = findLabelEndSimple(rest, idx);
  if (le === -1) return null;
  const label = rest.slice(idx + 1, le);
  if (label.length === 0 || label.length > 999) return null;
  // A label containing an unescaped '[' is invalid (cm-547/cm-548/cm-590)
  if (label.replace(/\\./g, '').includes('[')) return null;
  // A label that normalizes to empty is not a valid definition (cm-552)
  if (normalizeLabel(label) === '') return null;
  if (rest[le + 1] !== ':') return null;
  let p = le + 2;
  // skip spaces/tabs/newlines (not across a blank line)
  p = skipDefWs(rest, p);
  if (p === -1) return null;
  let href;
  if (rest[p] === '<') {
    let k = p + 1, ok = false;
    while (k < rest.length) {
      if (rest[k] === '\\' && k + 1 < rest.length) { k += 2; continue; }
      if (rest[k] === '<' || rest[k] === '\n') break;
      if (rest[k] === '>') { ok = true; break; }
      k++;
    }
    if (!ok) return null;
    href = rest.slice(p + 1, k);
    p = k + 1;
  } else {
    let k = p, depth = 0;
    while (k < rest.length) {
      const ch = rest[k];
      if (ch === '\\' && k + 1 < rest.length && PUNCT.has(rest[k + 1])) { k += 2; continue; }
      if (isSpace(ch) || ch === '<') break;
      if (ch === '(') { depth++; k++; continue; }
      if (ch === ')') { if (depth === 0) break; depth--; k++; continue; }
      if (ch.charCodeAt(0) < 0x20) break;
      k++;
    }
    if (k === p) return null;
    href = rest.slice(p, k);
    p = k;
  }
  href = encodeHref(decodeNumeric(resolveEscapes(href)));
  let title = null;
  const saveP = p;
  const p2 = skipDefWs(rest, saveP);
  // A title must be separated from the destination by whitespace.
  if (p2 !== -1 && p2 > saveP && (rest[p2] === '"' || rest[p2] === "'" || rest[p2] === '(')) {
    const t = parseTitle(rest, p2);
    if (t) { title = t.title; p = t.end; }
    else p = saveP;
  } else {
    p = saveP;
  }
  // only spaces/tabs to end of line
  let q = p;
  while (q < rest.length && (rest[q] === ' ' || rest[q] === '\t')) q++;
  if (q < rest.length && rest[q] !== '\n') {
    // A title on a LATER line with trailing junk: fall back to a dest-only
    // definition (the title line becomes paragraph text).
    if (title !== null) {
      const destLines = rest.slice(0, saveP).split('\n').length;
      const titleLines = rest.slice(0, p2).split('\n').length;
      if (titleLines > destLines) {
        title = null;
        const nl = rest.indexOf('\n', saveP);
        p = nl === -1 ? rest.length : nl;
      } else return null;
    } else return null;
  }
  const linesUsed = rest.slice(0, p).split('\n').length;
  return { label, href, title, next: i + linesUsed };
}
// Skip spaces/tabs/newlines in a definition, failing across a blank line.
function skipDefWs(s, p) {
  let seenNl = false;
  while (p < s.length && isSpace(s[p])) {
    if (s[p] === '\n') {
      if (seenNl) return -1;
      seenNl = true;
      // blank line if next non-space char is also a newline
      let q = p + 1;
      while (q < s.length && (s[q] === ' ' || s[q] === '\t')) q++;
      if (s[q] === '\n' || q >= s.length) return -1;
    }
    p++;
  }
  return p;
}
// ---- block scanner ----
function finalizeParaLines(lines, refs) {
  const kept = [];
  let i = 0;
  while (i < lines.length) {
    // Definitions only at the start of a paragraph (before any text line).
    if (kept.length === 0) {
      const def = tryDefinition(lines, i);
      if (def) {
        const key = normalizeLabel(def.label);
        if (!refs.has(key)) refs.set(key, { href: def.href, title: def.title });
        i = def.next;
        continue;
      }
    }
    kept.push(lines[i]);
    i++;
  }
  if (kept.length === 0) return null;
  // Paragraph lines keep their leading whitespace (only the container
  // indent was stripped by the block scanner).
  return kept.join('\n');
}
function scanFenced(ls, i, fs, out) {
  const n = ls.length;
  let j = i + 1;
  const content = [];
  while (j < n) {
    const line = ls[j];
    const { col, idx } = indentInfo(line);
    if (col <= 3 && line[idx] === fs.ch) {
      let k = idx;
      while (line[k] === fs.ch) k++;
      if (k - idx >= fs.len) {
        let ok = true;
        while (k < line.length) { if (line[k] !== ' ' && line[k] !== '\t') { ok = false; break; } k++; }
        if (ok) { j++; break; }
      }
    }
    content.push(line);
    j++;
  }
  const strip = Math.min(indentInfo(ls[i]).col, 3);
  const mapped = content.map(l => stripCols(l, strip));
  const text = mapped.join('\n');
  const info = resolveEscapes(fs.info.split(/[ \t]/)[0]);
  out.push('<pre><code' + (info ? ' class="language-' + escAttr(info) + '"' : '') + '>' + esc(text) + (content.length && mapped[mapped.length - 1] !== '' ? '\n' : '') + '</code></pre>\n');
  return j;
}
function scanIndentedCode(ls, i, out) {
  const n = ls.length;
  const content = [];
  let j = i;
  while (j < n) {
    const line = ls[j];
    if (blank(line)) {
      let k = j + 1;
      while (k < n && blank(ls[k])) k++;
      if (k < n && indentInfo(ls[k]).col >= 4) { content.push(stripCols(line, 4)); j++; continue; }
      break;
    }
    if (indentInfo(line).col >= 4) { content.push(stripCols(line, 4)); j++; continue; }
    break;
  }
  while (content.length && blank(content[content.length - 1])) content.pop();
  const text = content.join('\n');
  out.push('<pre><code>' + esc(text) + (text ? '\n' : '') + '</code></pre>\n');
  return j;
}
function scanHtmlBlock(ls, i, type, out, eof) {
  const n = ls.length;
  const content = [];
  let j = i;
  if (type === 1) {
    const m = /^ {0,3}<(pre|script|style|textarea)/i.exec(ls[i]);
    const tag = m[1].toLowerCase();
    const closeRe = new RegExp('</' + tag + '(?:[ \\t>]|$)', 'i');
    while (j < n) {
      content.push(ls[j]);
      if (closeRe.test(ls[j])) { j++; break; }
      j++;
    }
  } else if (type === 2) {
    while (j < n) { content.push(ls[j]); if (ls[j].includes('-->')) { j++; break; } j++; }
  } else if (type === 3) {
    while (j < n) { content.push(ls[j]); if (ls[j].includes('?>')) { j++; break; } j++; }
  } else if (type === 4) {
    while (j < n) { content.push(ls[j]); if (ls[j].includes('>')) { j++; break; } j++; }
  } else if (type === 5) {
    while (j < n) { content.push(ls[j]); if (ls[j].includes(']]>')) { j++; break; } j++; }
  } else {
    while (j < n && !blank(ls[j])) { content.push(ls[j]); j++; }
  }
  // Trailing newline is kept unless the block is followed by a blank line,
  // or it ends a container's inner lines that do not reach the input's EOF.
  const trailing = (j < n && !blank(ls[j])) || (j === n && eof);
  out.push(content.join('\n') + (trailing ? '\n' : ''));
  return j;
}
function scanParagraph(ls, i, out, refs, paraMode, paraPrefix) {
  const n = ls.length;
  const paraLines = [];
  let j = i;
  while (j < n) {
    const line = ls[j];
    if (blank(line)) {
      // A trailing whitespace-only line is the paragraph's trailing
      // whitespace, not a separator (cm-241).
      if (line !== '' && j === n - 1) { paraLines.push(line); j++; }
      break;
    }
    const { col, idx } = indentInfo(line);
    if (j > i && col <= 3) {
      const sl = setextLevel(line);
      if (sl) {
        const text = finalizeParaLines(paraLines, refs);
        if (text !== null) {
          out.push({ para: text, mode: 'heading', level: sl, prefix: paraPrefix });
          return j + 1;
        }
        // Only definitions so far: not a heading; the line is paragraph text.
      }
      const aligns = tableDelim(line);
      if (aligns) {
        const headerCells = splitTableRow(paraLines[paraLines.length - 1]);
        if (headerCells.length === aligns.length) {
          const headLine = paraLines.pop();
          const text = finalizeParaLines(paraLines, refs);
          if (text !== null) out.push({ para: text, mode: paraMode, prefix: paraPrefix });
          return scanTable(ls, j - 1, headLine, aligns, out, refs);
        }
      }
      if (atxHeading(line) || fenceStart(line) || isHR(line)) break;
      const hb = htmlBlockStart(line);
      if (hb >= 1 && hb <= 6) break;
      if (line[idx] === '>') break;
      const lm = listMarker(line);
      if (lm) {
        const content = stripPrefix(line, lm.contentCol);
        if (content !== '' && (!lm.ordered || lm.num === 1)) break;
      }
    }
    paraLines.push(line);
    j++;
  }
  const text = finalizeParaLines(paraLines, refs);
  if (text !== null) out.push({ para: text, mode: paraMode, prefix: paraPrefix });
  return j;
}
function scanLines(ls, out, refs, paraMode, eof, paraPrefix) {
  let i = 0;
  const n = ls.length;
  while (i < n) {
    const line = ls[i];
    if (blank(line)) { i++; continue; }
    const { col, idx } = indentInfo(line);
    if (col <= 3) {
      const atx = atxHeading(line);
      if (atx) { out.push({ para: atx.text, mode: 'heading', level: atx.level }); i++; continue; }
      const fs = fenceStart(line);
      if (fs) { i = scanFenced(ls, i, fs, out); continue; }
      if (isHR(line)) { out.push('<hr>\n'); i++; continue; }
      const hb = htmlBlockStart(line);
      if (hb >= 1) { i = scanHtmlBlock(ls, i, hb, out, eof); continue; }
      if (line[idx] === '>') { i = scanBlockquote(ls, i, out, refs, eof); continue; }
      const lm = listMarker(line);
      if (lm) { i = scanList(ls, i, out, refs, eof); continue; }
    }
    if (col >= 4) { i = scanIndentedCode(ls, i, out); continue; }
    i = scanParagraph(ls, i, out, refs, paraMode, paraPrefix);
    paraPrefix = undefined;
  }
  return i;
}
// Is this line a paragraph line (not a block start)? Used for lazy continuation.
function isParaLine(line) {
  if (blank(line)) return false;
  const { col, idx } = indentInfo(line);
  if (col >= 4) return false;
  if (atxHeading(line) || fenceStart(line) || isHR(line) || setextLevel(line)) return false;
  if (htmlBlockStart(line) >= 1) return false;
  if (tableDelim(line)) return false;
  if (line[idx] === '>') {
    const inner = line.slice(idx + 1).replace(/^[ \t]/, '');
    return isParaLine(inner);
  }
  const lm = listMarker(line);
  if (lm) return stripPrefix(line, lm.contentCol) !== '';
  return true;
}
// Does the last block in `lines` end with an open paragraph?
function endsWithOpenPara(lines) {
  let inFence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (inFence) {
      const { col, idx } = indentInfo(line);
      if (col <= 3 && line[idx] === inFence.ch) {
        let k = idx;
        while (line[k] === inFence.ch) k++;
        if (k - idx >= inFence.len) {
          let ok = true;
          while (k < line.length) { if (line[k] !== ' ' && line[k] !== '\t') { ok = false; break; } k++; }
          if (ok) inFence = null;
        }
      }
      continue;
    }
    const fs = fenceStart(line);
    if (fs) inFence = fs;
  }
  if (inFence) return false;
  // A blank line closes the paragraph: the LAST line itself must be a
  // paragraph line (no skipping blanks).
  const li = lines.length - 1;
  if (li < 0) return false;
  return isParaLine(lines[li]);
}
// A lazy continuation line: a paragraph line while the container's last block
// is an open paragraph (block starts are never lazy continuations).
function isLazyContinuation(line, innerLines) {
  if (blank(line)) return false;
  const { col, idx } = indentInfo(line);
  if (col <= 3) {
    if (atxHeading(line) || fenceStart(line) || isHR(line)) return false;
    const hb = htmlBlockStart(line);
    if (hb >= 1 && hb <= 6) return false;
    if (line[idx] === '>') return false;
    if (listMarker(line)) return false;
  }
  return endsWithOpenPara(innerLines);
}
function scanBlockquote(ls, i, out, refs, parentEof) {
  const n = ls.length;
  const inner = [];
  let j = i;
  while (j < n) {
    const line = ls[j];
    // A blank line without a '>' marker ends the blockquote (marked splits
    // it into two blockquotes); a '>' line with empty content continues it.
    if (blank(line)) break;
    const { col, idx } = indentInfo(line);
    if (col <= 3 && line[idx] === '>') {
      let s = line.slice(idx + 1);
      if (s[0] === ' ' || s[0] === '\t') s = s.slice(1);
      inner.push(s);
      j++;
      continue;
    }
    if (isLazyContinuation(line, inner)) {
      // A lazy setext-underline-looking line is paragraph text, not a
      // heading underline, and is indented 4 columns (cm-093).
      const text = /^ {0,3}(=+|-+)[ \t]*$/.test(line) ? '    ' + line : line.replace(/^[ \t]+/, '');
      // Join to the paragraph's last line so it is not re-parsed as a block
      // (a stripped lazy line may look like a list item, cm-238).
      let li = inner.length - 1;
      while (li >= 0 && blank(inner[li])) li--;
      if (li >= 0) inner[li] = inner[li] + '\n' + text;
      else inner.push(text);
      j++; continue;
    }
    break;
  }
  while (inner.length && inner[inner.length - 1] === '') inner.pop();
  out.push('<blockquote>\n');
  scanLines(inner, out, refs, 'normal', j === n && parentEof);
  out.push('</blockquote>\n');
  return j;
}
function scanList(ls, i, out, refs, parentEof) {
  const n = ls.length;
  const first = listMarker(ls[i]);
  const baseCol = indentInfo(ls[i]).col;
  const ordered = first.ordered;
  const items = [];
  let loose = false;
  let j = i;
  while (j < n) {
    const line = ls[j];
    if (isHR(line)) break; // thematic break beats a list item
    const lm = listMarker(line);
    if (!lm || lm.ordered !== ordered || (ordered ? lm.delim !== first.delim : lm.bullet !== first.bullet)) break;
    // Items may be indented 0-3 relative to the list base (cm-295); the
    // content column is per-item.
    let cc = lm.contentCol;
    if (stripPrefix(line, lm.contentCol) === '') {
      // Empty first line: content starts one space after the marker.
      let ml = 1;
      if (lm.ordered) { let q = indentInfo(line).idx; while (line[q] >= '0' && line[q] <= '9') q++; ml = q - indentInfo(line).idx + 1; }
      cc = indentInfo(line).col + ml + 1;
    }
    const itemLines = [stripPrefix(line, cc)];
    let itemBlank = false;
    let k = j + 1;
    while (k < n) {
      const l2 = ls[k];
      if (blank(l2)) {
        // An empty item ends at a blank line (cm-280).
        if (itemLines.length === 1 && itemLines[0] === '') break;
        let m = k + 1;
        while (m < n && blank(ls[m])) m++;
        if (m >= n) break;
        const lm2 = listMarker(ls[m]);
        if (!isHR(ls[m]) && lm2 && indentInfo(ls[m]).col < cc && lm2.ordered === ordered && (ordered ? lm2.delim === first.delim : lm2.bullet === first.bullet)) {
          loose = true;
          break;
        }
        // After a blank line the paragraph is closed: only a line indented
        // to the item's content column can continue the item (no lazy
        // continuation across a blank line).
        if (indentInfo(ls[m]).col >= cc) {
          // A blank inside a nested container belongs to that container;
          // it does not make THIS list loose. Nested = the lines on both
          // sides are inside nested content (indented or container starts).
          const prev = itemLines[itemLines.length - 1];
          const prevNested = prev !== undefined && (indentInfo(prev).col > 0 || listMarker(prev) !== null || prev.replace(/^[ \t]+/, '').startsWith('>') || fenceStart(prev) !== null);
          const nextStripped = stripPrefix(ls[m], cc);
          const nextNested = indentInfo(nextStripped).col > 0 || listMarker(nextStripped) !== null || nextStripped.replace(/^[ \t]+/, '').startsWith('>') || fenceStart(nextStripped) !== null;
          if (!(prevNested && nextNested) && !hasOpenFence(itemLines)) itemBlank = true;
          while (k < m) { itemLines.push(''); k++; }
          continue;
        }
        break;
      }
      if (indentInfo(l2).col >= cc) {
        itemLines.push(stripPrefix(l2, cc));
        k++;
        continue;
      }
      if (isLazyContinuation(l2, itemLines)) {
        // Join to the paragraph's last line so a stripped lazy line that
        // looks like a list item is not re-parsed as one (cm-312).
        const text = l2.replace(/^[ \t]+/, '');
        let li = itemLines.length - 1;
        while (li >= 0 && blank(itemLines[li])) li--;
        if (li >= 0) itemLines[li] = itemLines[li] + '\n' + text;
        else itemLines.push(text);
        k++; continue;
      }
      break;
    }
    if (itemBlank) loose = true;
    items.push(itemLines);
    j = k;
    let m = j;
    while (m < n && blank(ls[m])) m++;
    if (m < n) {
      const lm2 = listMarker(ls[m]);
      if (!isHR(ls[m]) && lm2 && indentInfo(ls[m]).col < cc && lm2.ordered === ordered && (ordered ? lm2.delim === first.delim : lm2.bullet === first.bullet)) {
        if (m > j) loose = true; // blank line(s) between items
        j = m;
        continue;
      }
    }
    j = m;
    break;
  }
  out.push(ordered ? '<ol' + (first.num !== 1 ? ' start="' + first.num + '"' : '') + '>\n' : '<ul>\n');
  const listEof = j === n && parentEof;
  for (let ii = 0; ii < items.length; ii++) {
    let lines = items[ii];
    let prefix;
    if (lines.length && lines[0] !== '') {
      const tm = /^\[([ xX])\](?:[ \t]|$)/.exec(lines[0]);
      if (tm) {
        prefix = tm[1] === ' ' ? '<input disabled="" type="checkbox"> ' : '<input checked="" disabled="" type="checkbox"> ';
        lines = [lines[0].slice(tm[0].length), ...lines.slice(1)];
      }
    }
    out.push('<li>');
    // Empty task item: no paragraph will be created; emit the checkbox raw.
    if (prefix && lines.every(l => blank(l))) { out.push(prefix.trimEnd()); scanLines(lines, out, refs, loose ? 'normal' : 'bare', ii === items.length - 1 && listEof); }
    else scanLines(lines, out, refs, loose ? 'normal' : 'bare', ii === items.length - 1 && listEof, prefix);
    out.push('</li>\n');
  }
  out.push(ordered ? '</ol>\n' : '</ul>\n');
  return j;
}
function scanTable(ls, headerIdx, headLine, aligns, out, refs) {
  const n = ls.length;
  const headerCells = splitTableRow(headLine);
  const rows = [];
  let j = headerIdx + 2;
  while (j < n) {
    const line = ls[j];
    if (blank(line)) break;
    const { col, idx } = indentInfo(line);
    if (col > 3) break;
    if (atxHeading(line) || fenceStart(line) || isHR(line)) break;
    if (htmlBlockStart(line) >= 1 && htmlBlockStart(line) <= 6) break;
    if (line[idx] === '>') break;
    if (listMarker(line)) break;
    rows.push(splitTableRow(line));
    j++;
  }
  // Defer rendering: cells may reference definitions declared later.
  out.push({ table: { headerCells, aligns, rows } });
  return j;
}
function renderTable(t, refs) {
  let html = '<table>\n<thead>\n<tr>\n';
  for (let c = 0; c < t.headerCells.length; c++) {
    html += '<th' + (t.aligns[c] ? ' align="' + t.aligns[c] + '"' : '') + '>' + renderInline(t.headerCells[c], refs) + '</th>\n';
  }
  html += '</tr>\n</thead>\n';
  if (t.rows.length === 0) return html + '</table>\n';
  html += '<tbody>';
  for (const cells of t.rows) {
    html += '<tr>\n';
    for (let c = 0; c < t.aligns.length; c++) {
      const cellText = c < cells.length ? cells[c] : '';
      html += '<td' + (t.aligns[c] ? ' align="' + t.aligns[c] + '"' : '') + '>' + renderInline(cellText, refs) + '</td>\n';
    }
    html += '</tr>\n';
  }
  html += '</tbody></table>\n';
  return html;
}
// ---- entry point ----
function renderPara(ph, refs) {
  if (ph.table) return renderTable(ph.table, refs);
  const pre = ph.prefix || '';
  if (ph.mode === 'heading') {
    const t = ph.para.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
    return '<h' + ph.level + '>' + pre + renderInline(t, refs) + '</h' + ph.level + '>\n';
  }
  if (ph.mode === 'bare') return pre + renderInline(ph.para, refs);
  return '<p>' + pre + renderInline(ph.para, refs) + '</p>\n';
}
function parse(markdown) {
  const src = String(markdown).replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  // A trailing newline does not create an extra empty line.
  if (src.endsWith('\n') && lines.length > 1) lines.pop();
  const refs = new Map();
  const out = [];
  scanLines(lines, out, refs, 'normal', src.endsWith('\n'));
  let html = '';
  for (let k = 0; k < out.length; k++) {
    const item = out[k];
    html += typeof item === 'string' ? item : renderPara(item, refs);
  }
  return html;
}
export default parse;
export { parse };
