// parse.js — dependency-free CommonMark 0.31.2 + GFM 0.29 renderer.
// parse(markdown) returns exactly the HTML marked 18.1.3 produces with
// default options. Written fresh for make.fun markdown-render-speed-02.

// ---------------------------------------------------------------- utilities

const CODE_INDENT = 4;

function isSpace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}
function isBlank(s) {
  return /^[ \t]*$/.test(s);
}
// ASCII punctuation per CommonMark (plus backtick is handled separately).
const UNICODE_PUNCT = /[\p{P}\p{S}]/u;
function isPunct(ch) {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) ||
    (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
}
// Unicode punctuation (general categories P and S) — used ONLY for
// emphasis flanking rules (cm-354). Backslash escapes use ASCII isPunct
// only (cm-013: \« stays literal).
function isPunctUni(ch) {
  if (!ch) return false;
  if (isPunct(ch)) return true;
  const c = ch.charCodeAt(0);
  return c > 127 && UNICODE_PUNCT.test(ch);
}
function isWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

// Escape text for HTML output. Marked's rule: escape & < > " ' except that
// an & starting something that looks like an entity reference
// (&name; / &#123; / &#x1f;) is left alone. Named entities are NOT decoded.
const ENTITY_LIKE = /&(?:#\d{1,7};|#[Xx][0-9A-Fa-f]{1,6};|[A-Za-z][A-Za-z0-9]*;|[A-Za-z][A-Za-z0-9]*$)/;
function escapeText(s) {
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (ch === '&') {
      // preserve &name; / &#...; / &#x...;
      const rest = s.slice(i);
      const m = /^&(?:#[0-9]{1,7};|#[Xx][0-9A-Fa-f]{1,6};|[A-Za-z][A-Za-z0-9]*;)/.exec(rest);
      if (m) { out += m[0]; i += m[0].length; continue; }
      out += '&amp;'; i++; continue;
    }
    if (ch === '<') { out += '&lt;'; i++; continue; }
    if (ch === '>') { out += '&gt;'; i++; continue; }
    if (ch === '"') { out += '&quot;'; i++; continue; }
    if (ch === "'") { out += '&#39;'; i++; continue; }
    out += ch; i++;
  }
  return out;
}
// Escape for code spans / code blocks: & < > " ' are all escaped, and & is
// ALWAYS escaped (no entity preservation, unlike text; cm-211, cm-343).
function escapeCode(s) {
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (ch === '&') { out += '&amp;'; i++; continue; }
    if (ch === '<') { out += '&lt;'; i++; continue; }
    if (ch === '>') { out += '&gt;'; i++; continue; }
    if (ch === '"') { out += '&quot;'; i++; continue; }
    if (ch === "'") { out += '&#39;'; i++; continue; }
    out += ch; i++;
  }
  return out;
}
// Escape for attribute values (href/title): same no-encode rule as text.
const escapeAttr = escapeText;

// Decode a numeric character reference starting at s[i] === '&'.
// Returns [decodedChar, lengthConsumed] or null if not a numeric ref.
function decodeNumericRef(s, i) {
  if (s[i] !== '&' || s[i + 1] !== '#') return null;
  let j = i + 2;
  let cp;
  if (s[j] === 'x' || s[j] === 'X') {
    j++;
    const start = j;
    while (j < s.length && /[0-9A-Fa-f]/.test(s[j])) j++;
    if (j === start || j - start > 6 || s[j] !== ';') return null;
    cp = parseInt(s.slice(start, j), 16);
    j++; // ;
  } else {
    const start = j;
    while (j < s.length && s[j] >= '0' && s[j] <= '9') j++;
    if (j === start || j - start > 7 || s[j] !== ';') return null;
    cp = parseInt(s.slice(start, j), 10);
    j++; // ;
  }
  if (cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) cp = 0xFFFD;
  return [String.fromCodePoint(cp), j - i];
}

// Unescape backslash escapes: \ + ASCII punctuation -> the punctuation.
function unescapeStr(s) {
  if (s.indexOf('\\') < 0) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length && isPunct(s[i + 1])) { out += s[i + 1]; i++; }
    else out += s[i];
  }
  return out;
}

// ---------------------------------------------------------------- block nodes

function blk(type) {
  return { t: type, children: [], parent: null };
}
function addChild(parent, child) {
  child.parent = parent;
  parent.children.push(child);
  return child;
}

// ---------------------------------------------------------------- block parser

const BLOCK_TAGS = new Set(('address article aside base basefont blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hr html iframe legend li link main menu menuitem nav noframes ol optgroup option p param search section summary table tbody td tfoot th thead title tr track ul').split(' '));

class BlockParser {
  constructor() {
    this.doc = blk('document');
    this.tip = this.doc;
    this.refs = {}; // normalized label -> {dest, title}
    this.lineNumber = 0;
  }

  parse(src) {
    src = src.replace(/\r\n?/g, '\n');
    this.srcEndsWithNewline = src.endsWith('\n');
    this.atEof = false;
    // Split into lines; a trailing \n does not create an extra line.
    let lines = src.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    this.lines = lines;
    // Expand tabs in the leading whitespace of each line to spaces
    // (tab stops of 4, by original column). Middle-of-line tabs are kept
    // as-is. This makes container/code indentation column-correct.
    // The RAW lines are kept too: code-block content is re-derived from
    // them so a literal tab inside code survives (see processLineContent).
    this.rawLines = lines;
    lines = lines.map(expandStructuralTabs);
    for (const line of lines) {
      this.lineNumber++;
      this.incorporateLine(line);
    }
    // finalize all open blocks
    this.atEof = true;
    while (this.tip) {
      this.finalize(this.tip, this.lineNumber);
      this.tip = this.tip.parent;
    }
    this.processInlines(this.doc);
    return this.doc;
  }

  // ---- container matching -------------------------------------------------
  // Returns [matchedContainer, offset, column, indent, partiallyConsumedTab]
  // `line` is the raw line string.
  incorporateLine(line) {
    // phase 1: match open containers; container = last matched, offset =
    // content offset within it. A container that fails to match ends the
    // descent; blocks below it are closed lazily (see processLineContent).
    let container = this.doc;
    let allMatched = true;
    let offset = 0;
    let lastChild;
    while ((lastChild = container.children[container.children.length - 1]) &&
      (lastChild.t === 'blockquote' || lastChild.t === 'list' || lastChild.t === 'item') &&
      !lastChild.closed) {
      const next = lastChild;
      if (next.t === 'blockquote') {
        let i = offset;
        let spaces = 0;
        while (i < line.length && line[i] === ' ' && spaces < 3) { i++; spaces++; }
        if (i < line.length && line[i] === '>') {
          i++;
          if (i < line.length && (line[i] === ' ' || line[i] === '\t')) i++;
          offset = i;
          container = next;
        } else { allMatched = false; break; }
      } else if (next.t === 'list') {
        container = next; // a list always matches (its item decides)
      } else { // item
        const res = matchIndent(line, offset, next.contentIndent);
        if (!res.matched) {
          if (isBlank(line.slice(offset))) {
            // A blank line matches an item only if the item already has
            // content; an empty item is closed by the blank line (cm-280).
            // The list stays open so a following new item can continue it.
            if (next.children.length === 0) {
              // the empty item ends with a blank line (loose list, cm-315)
              next.lastLineBlank = true;
              container = next.parent;
              allMatched = false;
              break;
            }
            offset = line.length; container = next;
          }
          else {
            // The line does not belong to this item. If it starts a new
            // item for the parent list, the container is the list; otherwise
            // the line belongs to the list's parent (the list is closed).
            const parentList = container;
            // a new item may be indented up to 3 spaces at the list level
            const rest = line.slice(offset);
            let sp = 0;
            while (sp < rest.length && rest[sp] === ' ' && sp < 3) sp++;
            const contentAtList = rest.slice(sp);
            // a thematic break ends the list (it is not a list item)
            if (/^(?:\*[ \t]*){3,}$/.test(contentAtList) ||
              /^(?:-[ \t]*){3,}$/.test(contentAtList) ||
              /^(?:_[ \t]*){3,}$/.test(contentAtList)) {
              container = parentList.parent;
              allMatched = false;
              break;
            }
            const info = sp < 4 ? parseListMarker(contentAtList) : null;
            const isNewItem = info && parentList.listType === info.type &&
              ((info.type === 'bullet' && parentList.bulletChar === info.marker) ||
                (info.type === 'ordered' && parentList.delimiter === info.delimiter));
            if (isNewItem) { allMatched = false; break; }
            // If the line would only be indented code at the parent level,
            // it stays in the item as a lazy line — but only when there is
            // an open paragraph to continue, or the line sits inside a
            // container (offset > 0, e.g. a blockquote) where the columns
            // shift (cm-259/291/312). Otherwise it is a new block outside
            // the list, e.g. indented code (cm-257/313).
            const indAtParent = countIndent(line, offset);
            if (indAtParent.indent >= 4 && (this.tip.t === 'paragraph' || offset > 0)) {
              container = next;
              allMatched = false;
              break;
            }
            container = parentList.parent;
            allMatched = false;
            break;
          }
        } else {
          if (res.partial > 0) {
            // expand the partially consumed tab into spaces
            line = line.slice(0, res.offset) + ' '.repeat(res.partial) + line.slice(res.offset + 1);
            offset = res.offset;
          } else {
            offset = res.offset;
          }
          container = next;
        }
      }
    }
    // If the container is a list whose last item was closed (e.g. an empty
    // item ended by a blank line), the line only stays in the list when it
    // starts a new item; otherwise the list ends (cm-280).
    if (container.t === 'list') {
      const last = container.children[container.children.length - 1];
      if (last && last.closed) {
        const rest = line.slice(offset);
        let sp = 0;
        while (sp < rest.length && rest[sp] === ' ' && sp < 3) sp++;
        const info = parseListMarker(rest.slice(sp));
        const isNew = info && container.listType === info.type &&
          ((info.type === 'bullet' && container.bulletChar === info.marker) ||
            (info.type === 'ordered' && container.delimiter === info.delimiter));
        if (!isNew) { container = container.parent; allMatched = false; }
      }
    }
    this.processLineContent(container, line, offset, allMatched);
  }

  // Process one line's content inside `container` (the last matched
  // container), starting at `offset`. Also used for the first line inside a
  // freshly opened blockquote/list item, where the fragment is passed as the
  // line with offset 0 and allMatched true.
  processLineContent(container, line, offset, allMatched) {
    const tip = this.tip;
    // Code block tip: content lines (containers must have matched).
    if (tip.t === 'code_block') {
      if (!allMatched) {
        this.closeToContainer(container);
      } else {
        // Re-derive the content from the RAW source line so a literal tab
        // inside code survives (the expanded line turned it into spaces).
        // Only when this is a full source line (expanding the raw line
        // reproduces the line we were given); fragments fall back to the
        // expanded line.
        if (this.rawLines && this.lineNumber >= 1 && this.lineNumber <= this.rawLines.length) {
          const raw = this.rawLines[this.lineNumber - 1];
          if (raw !== undefined && expandStructuralTabs(raw) === line) {
            const ro = rawOffsetForExpanded(raw, line, offset);
            if (ro >= 0) { offset = ro; line = raw; }
          }
        }
        let text;
        if (tip.fenced) {
          // strip up to the opening fence's indent from content lines
          const r = stripUpTo(line, offset, tip.fenceIndent || 0);
          text = (r.partial ? ' '.repeat(r.partial) : '') + line.slice(r.offset);
          if (isClosingFence(text, tip)) {
            this.finalize(tip, this.lineNumber);
            this.tip = tip.parent;
            return;
          }
        } else {
          // Indented code: a non-blank line with < 4 indent ends the block.
          const ind = countIndent(line, offset);
          if (!isBlank(line.slice(offset)) && ind.indent < 4) {
            this.finalize(tip, this.lineNumber);
            this.tip = tip.parent;
            // fall through to normal block processing below
          } else {
            const r = stripUpTo(line, offset, 4);
            text = (r.partial ? ' '.repeat(r.partial) : '') + line.slice(r.offset);
            // a whitespace-only line keeps its excess indent (cm-112)
            tip.literal = (tip.literal || '') + text + '\n';
            tip.lastLineBlank = isBlank(text);
            this.markLineNonBlank(tip);
            return;
          }
        }
        // fenced code: append the line (non-fenced returns above, or falls
        // through when the block just ended)
        if (this.tip === tip) {
          tip.literal = (tip.literal || '') + text + '\n';
          tip.lastLineBlank = isBlank(text);
          this.markLineNonBlank(tip);
          return;
        }
      }
    }
    // HTML block tip: content lines (containers must have matched).
    if (tip.t === 'html_block') {
      if (!allMatched) {
        this.closeToContainer(container);
      } else {
        if (isBlank(line.slice(offset)) && (tip.htmlType === 6 || tip.htmlType === 7)) {
          // types 6 and 7 end at a blank line; types 1-5 continue until
          // their end condition (blank lines are part of the block)
          this.finalize(tip, this.lineNumber);
          this.tip = tip.parent;
        } else {
          const blank = isBlank(line.slice(offset));
          tip.literal += line.slice(offset) + '\n';
          tip.lastLine = this.lineNumber;
          if (blank) {
            // blank line inside a type 1-6 html block: part of the block,
            // but still marks the containers as blank-separated
            let c = tip;
            while (c) { c.lastLineBlank = true; c = c.parent; }
          } else {
            tip.lastLineBlank = false;
            this.markLineNonBlank(tip);
          }
          if (this.checkHtmlEnd(tip)) {
            this.finalize(tip, this.lineNumber);
            this.tip = tip.parent;
          }
          return;
        }
      }
    }

    // blank line? A line is blank if the content after the container
    // markers is empty, or if it is whitespace-only with no container
    // markers consumed. A whitespace-only line inside a container
    // (e.g. ">  " leaving " ") continues an open paragraph, but never
    // starts a new one.
    const afterOffset = line.slice(offset);
    const isBlankLine = isBlank(afterOffset) && (offset === 0 || afterOffset === '');
    if (isBlankLine || (isBlank(afterOffset) && this.tip.t !== 'paragraph')) {
      // A blank line closes containers it does not match (e.g. a
      // blockquote ends; a list item stays open because the list matches).
      this.closeToContainer(container);
      // Mark blank-separated, propagating up through lists/items so a
      // blank line inside a nested list loosens the outer list (cm-325),
      // but stopping at a blockquote: a blank line inside a blockquote
      // does not loosen the enclosing list (cm-320).
      let c = this.tip;
      while (c) {
        c.lastLineBlank = true;
        if (c.t === 'blockquote') break;
        c = c.parent;
      }
      return;
    }

    // non-blank line: compute indent/content
    const ind = countIndent(line, offset);
    const indent = ind.indent;
    const curOffset = ind.offset;
    const content = line.slice(curOffset);

    // Setext heading underline (also works as a lazy continuation line).
    // Only when the line matched all open containers (a line outside a
    // blockquote cannot underline a paragraph inside it).
    if (this.tip.t === 'paragraph' && allMatched) {
      const m = /^(=+|-+)[ \t]*$/.exec(content);
      if (m && indent < 4) {
        const level = m[1][0] === '=' ? 1 : 2;
        const para = this.tip;
        // Extract link reference definitions first; only the remaining
        // lines can form the heading text (cm-215/216).
        this.tryParseRefs(para);
        if (para.lines.length === 0) {
          // paragraph consumed entirely by ref defs: no heading; the
          // underline line starts a new paragraph below
          const parent = para.parent;
          const idx = parent.children.indexOf(para);
          if (idx >= 0) parent.children.splice(idx, 1);
          this.tip = parent;
        } else {
          const heading = blk('heading');
          heading.level = level;
          // setext heading text: leading/trailing whitespace stripped
          heading.lines = para.lines.map((ln, idx) => {
            let s = ln;
            if (idx === 0) s = s.replace(/^[ \t]+/, '');
            if (idx === para.lines.length - 1) s = s.replace(/[ \t]+$/, '');
            return s;
          });
          const parent = para.parent;
          const idx = parent.children.indexOf(para);
          parent.children[idx] = heading;
          heading.parent = parent;
          this.tip = heading;
          this.finalize(heading, this.lineNumber);
          this.tip = parent;
          return;
        }
      }
    }

    // Try to start new blocks.
    if (this.tryStartBlocks(container, line, offset, curOffset, indent, content, allMatched)) return;

    // Otherwise the line belongs to the open paragraph (lazy continuation
    // included) or starts a new one. Paragraph lines keep their leading
    // spaces (after container markers), so use the raw slice — except for
    // a lazy continuation (some container did not match), whose leading
    // whitespace is stripped.
    if (this.tip.t === 'paragraph') {
      // A lazy line that starts a table (header + delimiter row next)
      // is NOT a paragraph continuation: the table is a new block, so
      // the paragraph (and its list item) ends here and the line starts
      // a fresh paragraph that tryParseTable will turn into a table.
      if (!allMatched) {
        const nextRaw = this.lines && this.lineNumber < this.lines.length
          ? this.lines[this.lineNumber] : null;
        if (nextRaw !== null && nextRaw !== undefined) {
          const hdr = splitTableRow(content);
          const del = parseTableDelimiterRow(nextRaw);
          if (hdr && del && hdr.length === del.length) {
            // fall through to start a new paragraph below
            this.closeToContainer(container);
            this.noteBlockStart(container);
            const p = blk('paragraph');
            p.lines = [];
            addChild(container, p);
            this.tip = p;
            this.addLineToParagraph(p, content, indent);
            return;
          }
        }
      }
      const raw = line.slice(offset);
      // A lazy line's leading whitespace is stripped only when no
      // container consumed any indent (offset 0): the whitespace then
      // belongs to the failed container. When a parent container did
      // match and consume its indent, the remaining whitespace is
      // paragraph content (e.g. a tab expanding past a list item's
      // content indent leaves a real leading space).
      this.addLineToParagraph(this.tip, (!allMatched && offset === 0) ? raw.replace(/^[ \t]+/, '') : raw, indent);
      this.markLineNonBlank(this.tip);
      return;
    }
    this.closeToContainer(container);
    this.noteBlockStart(container);
    const p = blk('paragraph');
    p.lines = [];
    addChild(container, p);
    this.tip = p;
    // A new paragraph's first line keeps its leading spaces, except inside
    // a list item, where spaces are stripped up to the item's content
    // indent (cm-259: an outdented line becomes a bare paragraph line).
    let firstLine = line.slice(offset);
    if (container.t === 'item') {
      const col = columnAt(line, offset);
      const need = container.contentIndent - col;
      if (need > 0) {
        const r = stripUpTo(firstLine, 0, need);
        firstLine = (r.partial ? ' '.repeat(r.partial) : '') + firstLine.slice(r.offset);
      }
    }
    this.addLineToParagraph(p, firstLine, indent);
  }

  // Finalize open blocks from the tip down to (but not including) container.
  closeToContainer(container) {
    while (this.tip !== container && this.tip) {
      this.finalize(this.tip, this.lineNumber);
      this.tip = this.tip.parent;
    }
  }

  // Check whether an html block's accumulated literal ends it.
  checkHtmlEnd(html) {
    if (html.htmlType === 1) return htmlBlockEnd1(html.literal);
    if (html.htmlType === 2) return html.literal.includes('-->');
    if (html.htmlType === 3) return html.literal.includes('?>');
    if (html.htmlType === 4) return />/.test(html.literal);
    if (html.htmlType === 5) return html.literal.includes(']]>');
    return false;
  }

  // Try to start a new block at `container` from the line content.
  // Returns true if a block was started (line consumed).
  tryStartBlocks(container, line, offset, curOffset, indent, content, allMatched) {
    const tip = this.tip;
    // A paragraph only blocks a new block when the block would be a sibling
    // of the paragraph (same container). If the paragraph lives inside a
    // container the line has already left (e.g. an old list), the paragraph
    // is closed by the container mismatch and the new block may start.
    const canInterruptPara = tip.t !== 'paragraph' || tip.parent !== container;

    // ATX heading
    let m = /^(#{1,6})(?:[ \t]+|$)/.exec(content);
    if (m && indent < 4) {
      this.closeToContainer(container);
      this.noteBlockStart(container);
      const h = blk('heading');
      h.level = m[1].length;
      let text = content.slice(m[0].length);
      // strip optional closing sequence (a run of #s preceded by a space,
      // or the whole text if it is only #s) and surrounding whitespace
      if (/^[ \t]*#+[ \t]*$/.test(text)) text = '';
      else text = text.replace(/[ \t]+#+[ \t]*$/, '');
      text = text.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
      h.lines = [text];
      addChild(container, h);
      this.tip = h;
      this.finalize(h, this.lineNumber);
      this.tip = container;
      return true;
    }

    // Fenced code
    m = /^(`{3,}|~{3,})/.exec(content);
    if (m && indent < 4) {
      const fenceChar = m[1][0];
      const fenceLen = m[1].length;
      if (!(fenceChar === '`' && content.slice(m[0].length).includes('`'))) {
        this.closeToContainer(container);
        this.noteBlockStart(container);
        const code = blk('code_block');
        code.fenced = true;
        code.fenceChar = fenceChar;
        code.fenceLen = fenceLen;
        code.fenceIndent = indent;
        code.info = content.slice(m[0].length).trim();
        code.literal = '';
        addChild(container, code);
        this.tip = code;
        return true;
      }
    }

    // HTML block
    if (indent < 4 && content[0] === '<') {
      const htmlType = htmlBlockType(content, tip.t === 'paragraph');
      if (htmlType > 0) {
        this.closeToContainer(container);
        this.noteBlockStart(container);
        const html = blk('html_block');
        html.htmlType = htmlType;
        html.literal = '';
        addChild(container, html);
        this.tip = html;
        html.literal += line.slice(offset) + '\n';
        html.lastLine = this.lineNumber;
        html.lastLineBlank = false;
        if (this.checkHtmlEnd(html)) {
          this.finalize(html, this.lineNumber);
          this.tip = container;
        }
        return true;
      }
    }

    // Thematic break
    if (indent < 4 && (/^(?:\*[ \t]*){3,}$/.test(content) ||
      /^(?:-[ \t]*){3,}$/.test(content) ||
      /^(?:_[ \t]*){3,}$/.test(content))) {
      this.closeToContainer(container);
      this.noteBlockStart(container);
      const hr = blk('thematic_break');
      addChild(container, hr);
      this.finalize(hr, this.lineNumber);
      return true;
    }

    // Blockquote (only when indent < 4; otherwise indented code)
    if (content[0] === '>' && indent < 4) {
      this.closeToContainer(container);
      this.noteBlockStart(container);
      const bq = blk('blockquote');
      addChild(container, bq);
      this.tip = bq;
      // Recurse with the ORIGINAL line and the offset just past the '>'
      // (plus one optional space), so absolute-column math (list marker
      // columns) stays correct — fragments would reset the column.
      let noff = curOffset + 1;
      if (noff < line.length && (line[noff] === ' ' || line[noff] === '\t')) noff++;
      this.processLineContent(bq, line, noff, true);
      return true;
    }

    // List item
    const listInfo = parseListMarker(content);
    if (listInfo && indent < 4) {
      // A new item for an already-open list of the same kind can always
      // interrupt a paragraph (the list is a structural continuation);
      // a brand-new list follows the usual empty-item rule. A nested list
      // inside a list item may also start after the item's paragraph
      // (the paragraph is closed by the nested list).
      const sameList = container.t === 'list' && container.listType === listInfo.type &&
        ((listInfo.type === 'bullet' && container.bulletChar === listInfo.marker) ||
          (listInfo.type === 'ordered' && container.delimiter === listInfo.delimiter));
      const nestedInItem = container.t === 'item';
      const canInterrupt = canInterruptPara || listInfo.canInterruptPara || sameList || nestedInItem;
      if (canInterrupt) {
        this.closeToContainer(container);
        this.startList(container, listInfo, content, columnAt(line, curOffset), line, curOffset);
        return true;
      }
      // cannot interrupt a paragraph: paragraph continuation
      return false;
    }

    // Indented code block
    // Indented code. It can never interrupt an open paragraph (a lazy
    // continuation line is a paragraph line, not code — cm-238), and not
    // on a lazy line inside a list item (cm-259).
    if (indent >= 4 && tip.t !== 'paragraph' &&
      !(allMatched === false && container.t === 'item')) {
      this.closeToContainer(container);
      this.noteBlockStart(container);
      const code = blk('code_block');
      code.fenced = false;
      code.literal = '';
      addChild(container, code);
      this.tip = code;
      // First content line: re-derive from the raw source line so a
      // literal tab survives (same mapping as processLineContent).
      let rawLine = line, rawOff = offset;
      if (this.rawLines && this.lineNumber >= 1 && this.lineNumber <= this.rawLines.length) {
        const raw = this.rawLines[this.lineNumber - 1];
        if (raw !== undefined && expandStructuralTabs(raw) === line) {
          const ro = rawOffsetForExpanded(raw, line, offset);
          if (ro >= 0) { rawOff = ro; rawLine = raw; }
        }
      }
      const r = stripUpTo(rawLine, rawOff, 4);
      const text = (r.partial ? ' '.repeat(r.partial) : '') + rawLine.slice(r.offset);
      code.literal += text + '\n';
      code.lastLineBlank = isBlank(text);
      return true;
    }

    return false;
  }

  closeParagraph() {
    if (this.tip.t === 'paragraph') {
      this.finalize(this.tip, this.lineNumber);
      this.tip = this.tip.parent;
    }
  }

  addLineToParagraph(para, content, indent) {
    // After a hard break (previous line ends with 2+ spaces or a
    // backslash), the next line starts flush: strip its leading spaces
    // (cm-636/637).
    if (para.lines.length > 0) {
      const prev = para.lines[para.lines.length - 1];
      if (/ {2,}$/.test(prev) || /\\$/.test(prev)) {
        content = content.replace(/^[ \t]+/, '');
      }
    }
    para.lines.push(content);
  }

  // Parse link reference definitions from the start of the paragraph's lines.
  tryParseRefs(para) {
    let text = para.lines.join('\n');
    let consumed = 0;
    while (true) {
      const res = parseLinkReferenceDefinition(text, consumed);
      if (!res) break;
      const key = normalizeLabel(res.label);
      if (key && !(key in this.refs)) {
        this.refs[key] = { dest: res.dest, title: res.title };
      }
      consumed = res.end;
    }
    if (consumed > 0) {
      const rest = text.slice(consumed).replace(/^\n+/, '');
      para.lines = rest === '' ? [] : rest.split('\n');
    }
  }

  startList(container, info, content, markerCol, line, contentOffset) {
    // Find or create the list block. `container` may itself be a list of the
    // same kind (a new item at that list's level).
    let list = null;
    if (container.t === 'list' && container.listType === info.type &&
      ((info.type === 'bullet' && container.bulletChar === info.marker) ||
        (info.type === 'ordered' && container.delimiter === info.delimiter))) {
      list = container;
    } else {
      const last = container.children[container.children.length - 1];
      if (last && last.t === 'list' && last.listType === info.type &&
        ((info.type === 'bullet' && last.bulletChar === info.marker) ||
          (info.type === 'ordered' && last.delimiter === info.delimiter))) {
        list = last;
      } else {
        list = blk('list');
        list.listType = info.type;
        list.bulletChar = info.marker;
        list.delimiter = info.delimiter;
        list.start = info.type === 'ordered' ? info.start : null;
        list.tight = true;
        addChild(container, list);
      }
    }
    this.noteBlockStart(container);
    const item = blk('item');
    addChild(list, item);
    this.tip = item;
    // contentIndent is the ABSOLUTE column where the item's content starts
    item.contentIndent = (markerCol || 0) + info.contentIndent;
    item.open = true;
    // The rest of the line after the marker is the item's first content.
    // Strip the separator whitespace up to the content indent so the
    // content starts at the right column.
    const afterMarker = content.slice(info.markerLen);
    const sep = info.contentIndent - info.markerLen;
    const stripped = sep > 0 ? stripUpTo(afterMarker, 0, sep) : { offset: 0, partial: 0 };
    const firstLine = (stripped.partial ? ' '.repeat(stripped.partial) : '') + afterMarker.slice(stripped.offset);
    if (isBlank(firstLine)) {
      item.empty = true;
      return;
    }
    // Recurse with the ORIGINAL line and the offset of the first content,
    // so absolute-column math stays correct (a fragment would reset it).
    // When a tab was partially consumed, fall back to the fragment.
    if (line !== undefined && contentOffset !== undefined && !stripped.partial) {
      this.processLineContent(item, line, contentOffset + info.markerLen + stripped.offset, true);
    } else {
      this.processLineContent(item, firstLine, 0, true);
    }
  }

  finalize(block, lineNumber) {
    if (block.t === 'paragraph') {
      // Extract link reference definitions from the start of the
      // paragraph (all lines are available now, so multi-line defs
      // with the title on a following line work).
      this.tryParseRefs(block);
      if (block.lines.length === 0) {
        // paragraph consumed entirely by ref defs: remove it
        const parent = block.parent;
        if (parent) {
          const idx = parent.children.indexOf(block);
          if (idx >= 0) parent.children.splice(idx, 1);
        }
        block.closed = true;
        return;
      }
      // Table check: paragraph with >=2 lines where line 2 is a delimiter row.
      if (block.lines.length >= 2) {
        const table = tryParseTable(block.lines, this);
        if (table) {
          // replace paragraph with table in parent
          const parent = block.parent;
          const idx = parent.children.indexOf(block);
          parent.children[idx] = table;
          table.parent = parent;
          return;
        }
      }
      // A trailing whitespace-only line inside a LIST ITEM adds no content
      // and must not leave trailing whitespace in the tight-rendered
      // <li>. (A trailing whitespace line inside a blockquote IS content
      // — cm-241 keeps its single space — so only strip for items.)
      if (block.parent && block.parent.t === 'item') {
        while (block.lines.length > 1 && isBlank(block.lines[block.lines.length - 1])) {
          block.lines.pop();
        }
      }
      block.stringContent = block.lines.join('\n');
    } else if (block.t === 'heading') {
      block.stringContent = block.lines.join('\n');
    } else if (block.t === 'code_block') {
      if (!block.fenced) {
        // strip trailing blank lines, keeping one trailing \n if any content
        const ls = block.literal.split('\n');
        ls.pop(); // artifact of the trailing \n
        while (ls.length && isBlank(ls[ls.length - 1])) ls.pop();
        block.literal = ls.length ? ls.join('\n') + '\n' : '';
      } else if (block.parent && block.parent.t === 'item' && block.literal.endsWith('\n\n')) {
        // A fenced code block inside a list item: marked drops one trailing
        // blank line before the closing fence (cm-318: two blank lines in
        // the source become one in the literal).
        block.literal = block.literal.slice(0, -1);
      }
    } else if (block.t === 'html_block') {
      // The literal is built as line + '\n' per line. Keep the trailing
      // newline unless the line after the block's last line is blank,
      // the source does not end with a newline at EOF, or the block is
      // inside a container (list item / blockquote).
      const lastLine = block.lastLine || lineNumber;
      const next = this.lines ? this.lines[lastLine] : undefined;
      const atEof = next === undefined;
      const inContainer = block.parent && block.parent.t !== 'document';
      // A following line that is empty or spaces-only counts as blank
      // here; a tab-only line does not (its tab is content, not a blank
      // separator — the HTML block keeps its trailing newline then).
      const nextBlank = next !== undefined && /^[ ]*$/.test(next);
      if (nextBlank || (atEof && !this.srcEndsWithNewline) || inContainer) {
        if (block.literal.endsWith('\n')) block.literal = block.literal.slice(0, -1);
      }
    } else if (block.t === 'item') {
      block.open = false;
    } else if (block.t === 'list') {
      // loose if any item has two block children separated by a blank line
      // (looseChildren), or any non-last item ends with a blank line
      let tight = true;
      const items = block.children;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.looseChildren) tight = false;
        if (item.lastLineBlank && i < items.length - 1) tight = false;
      }
      block.tight = tight;
    }
    block.closed = true;
  }

  // A new block is starting directly inside `container`: if the container's
  // last line was blank, its children are blank-separated (loose).
  noteBlockStart(container) {
    if (container.lastLineBlank) container.looseChildren = true;
    this.markLineNonBlank(container);
  }

  // The current line is non-blank inside `block` and its ancestors.
  markLineNonBlank(block) {
    let c = block;
    while (c) { c.lastLineBlank = false; c = c.parent; }
  }

  processInlines(node) {
    // walk the tree; parse inline content of paragraph/heading/table cells
    if (node.t === 'paragraph' || node.t === 'heading') {
      node.inline = parseInline(node.stringContent || '', this.refs);
    } else if (node.t === 'table_cell') {
      node.inline = parseInline(node.stringContent || '', this.refs);
    }
    for (const child of node.children) this.processInlines(child);
  }
}

// Expand tabs in the leading whitespace of a line to spaces (tab stops of
// 4). Only the leading run of spaces/tabs is expanded; tabs after the first
// non-whitespace character are preserved.
function expandLeadingTabs(line) {
  let i = 0;
  let col = 0;
  while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
    if (line[i] === ' ') { col++; i++; }
    else {
      const adv = 4 - (col % 4);
      line = line.slice(0, i) + ' '.repeat(adv) + line.slice(i + 1);
      col += adv;
      i += adv;
    }
  }
  return line;
}

// Expand tabs that appear in the structural prefix of a line: leading
// whitespace plus blockquote/list/heading markers. Tabs after the first
// content character are preserved (they may be code content).
function expandStructuralTabs(line) {
  let col = 0;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === ' ') { col++; i++; }
    else if (ch === '\t') {
      const adv = 4 - (col % 4);
      line = line.slice(0, i) + ' '.repeat(adv) + line.slice(i + 1);
      col += adv;
      i += adv;
    }
    else if (ch === '>' || ch === '-' || ch === '+' || ch === '*' || ch === '#') {
      col++; i++;
    }
    else break;
  }
  return line;
}

// Count indentation (spaces/tabs) from `offset` in `line`.
// Returns {indent, offset, column, partial} where indent is in spaces
// (a tab advances to the next multiple of 4).
function countIndent(line, offset) {
  let indent = 0;
  let i = offset;
  while (i < line.length) {
    const ch = line[i];
    if (ch === ' ') { indent++; i++; }
    else if (ch === '\t') { indent += 4 - (indent % 4); i++; }
    else break;
  }
  return { indent, offset: i, column: indent };
}

// Match `n` spaces of indent starting at offset; handles partial tabs.
// Returns {matched, offset, indent, column, partial}.
// Column of the character at `offset` in `line` (tabs expand to the next
// multiple of 4).
function columnAt(line, offset) {
  let col = 0;
  for (let i = 0; i < offset && i < line.length; i++) {
    if (line[i] === '\t') col += 4 - (col % 4);
    else col++;
  }
  return col;
}

function matchIndent(line, offset, targetCol) {
  // Consume whitespace from `offset` until the absolute column reaches
  // `targetCol` (the item's absolute content column).
  let col = columnAt(line, offset);
  let i = offset;
  while (i < line.length && col < targetCol) {
    const ch = line[i];
    if (ch === ' ') { col++; i++; }
    else if (ch === '\t') {
      const adv = 4 - (col % 4);
      if (col + adv > targetCol) {
        return { matched: true, offset: i, indent: targetCol, column: targetCol, partial: adv - (targetCol - col) };
      }
      col += adv; i++;
    } else break;
  }
  if (col >= targetCol) {
    // If the content starts immediately after the container markers at a
    // column already past the item's content indent, it is not item
    // content (the markers themselves consumed the indent) — cm-260.
    if (col > targetCol && i === offset) return { matched: false };
    return { matched: true, offset: i, indent: col, column: col, partial: 0 };
  }
  return { matched: false };
}

// Strip up to n spaces of indent from line starting at offset (for code).
function stripUpTo(line, offset, n) {
  // Strip up to `n` columns of indent starting at `offset`. Tab advance
  // uses the ABSOLUTE column (tabs stop at multiples of 4), so a tab that
  // straddles the boundary yields `partial` spaces and a tab entirely
  // beyond the strip is preserved by the caller (line.slice(offset)).
  let indent = 0;
  let col = columnAt(line, offset);
  let i = offset;
  while (i < line.length && indent < n) {
    const ch = line[i];
    if (ch === ' ') { indent++; col++; i++; }
    else if (ch === '\t') {
      const adv = 4 - (col % 4);
      // The tab straddles the strip boundary: it is consumed and replaced
      // by `partial` spaces (the columns it contributes past the strip),
      // so the returned offset skips past the tab itself.
      if (indent + adv > n) return { offset: i + 1, partial: adv - (n - indent) };
      indent += adv; col += adv; i++;
    } else break;
  }
  // The strip ended exactly at a tab: the tab starts at the content
  // boundary, so expand it to spaces (its advance from the boundary
  // column) and consume it, instead of leaving a literal tab in the
  // content. When the boundary column is 0 (a top-level fence with no
  // indent stripped) a leading tab is content and stays literal.
  if (col > 0 && i < line.length && line[i] === '\t' && indent === n) {
    const adv = 4 - (col % 4);
    return { offset: i + 1, partial: adv };
  }
  return { offset: i };
}

// Map an offset in the EXPANDED line (tabs -> spaces) back to the
// corresponding offset in the RAW line. Tabs in the raw line expand to
// spaces; if the expanded offset falls INSIDE a tab's expansion (the
// container partially consumed that tab), return -1: the caller must
// keep the expanded line, whose partial-tab handling is already correct.
function rawOffsetForExpanded(raw, expanded, expOffset) {
  let r = 0, e = 0, col = 0;
  while (e < expOffset && r < raw.length) {
    const ch = raw[r];
    if (ch === '\t') {
      const adv = 4 - (col % 4);
      if (e + adv > expOffset) return -1;
      e += adv; col += adv; r++;
    } else {
      e++; col++; r++;
    }
  }
  return r;
}

// ---- fenced code helpers
function isClosingFence(text, code) {
  const m = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(text);
  if (!m) return false;
  if (m[1][0] !== code.fenceChar) return false;
  return m[1].length >= code.fenceLen;
}

// ---- HTML block type detection (CommonMark types 1-7)
// content is the line content after container markers (indent < 4).
function htmlBlockType(content, inParagraph) {
  if (content[0] !== '<') return 0;
  const s = content;
  // type 1: script, pre, style, textarea
  let m = /^<(script|pre|style|textarea)(?:[ \t>]|$)/i.exec(s);
  if (m) return 1;
  // type 2: comment
  if (/^<!--/.test(s)) return 2;
  // type 3: processing instruction
  if (/^<\?/.test(s)) return 3;
  // type 4: declaration
  if (/^<![A-Za-z]/.test(s)) return 4;
  // type 5: CDATA
  if (/^<!\[CDATA\[/.test(s)) return 5;
  // type 6: block tag. The start condition only requires the tag name to be
  // followed by a space, tab, end of line, '>' or '/>'; the tag may span
  // lines and its attributes are not validated. A closing tag, though,
  // takes no attributes (cm-624: </a href="foo"> is not a tag at all).
  if (s.startsWith('</')) {
    m = /^<\/([A-Za-z][A-Za-z0-9-]*)(?:[ \t]*>|$)/i.exec(s);
    if (m && BLOCK_TAGS.has(m[1].toLowerCase())) return 6;
  } else {
    m = /^<([A-Za-z][A-Za-z0-9-]*)(?:[ \t]|>|\/>|$)/i.exec(s);
    if (m && BLOCK_TAGS.has(m[1].toLowerCase())) return 6;
  }
  // type 7: complete open/close tag (not a block tag). A closing tag
  // takes no attributes (cm-624).
  if (!inParagraph) {
    let m7 = null;
    if (s.startsWith('</')) {
      m7 = /^<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>[ \t]*$/.exec(s);
    } else {
      m7 = /^<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^ \t"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>[ \t]*$/.exec(s);
    }
    if (m7) return 7;
  }
  return 0;
}
function htmlBlockEnd1(literal) {
  return /<\/(script|pre|style|textarea)>/i.test(literal);
}

// ---- list markers
function parseListMarker(content) {
  // bullet
  let m = /^([*+-])(?:[ \t]+(.*))?$/.exec(content);
  if (m) {
    const marker = m[1];
    const rest = m[2];
    if (rest === undefined || rest.trim() === '') {
      // empty item: "-" or "-   " (marker + only spaces)
      return { type: 'bullet', marker, markerLen: 1, contentIndent: 2, canInterruptPara: false };
    }
    // count spaces between marker and content (tabs count as advancing to 4)
    let spaces = 0;
    let i = 1;
    while (i < content.length && (content[i] === ' ' || content[i] === '\t')) {
      if (content[i] === ' ') spaces++;
      else spaces += 4 - (spaces % 4);
      i++;
    }
    let contentIndent;
    if (spaces === 0) {
      // marker followed directly by content? shouldn't happen (regex needs space)
      contentIndent = 1;
    } else if (spaces >= 5) {
      contentIndent = 2; // marker + 1 space; rest is content indent
    } else {
      contentIndent = 1 + spaces;
    }
    return { type: 'bullet', marker, markerLen: 1, contentIndent, canInterruptPara: true };
  }
  // ordered
  m = /^(\d{1,9})([.)])(?:[ \t]+(.*))?$/.exec(content);
  if (m) {
    const num = m[1];
    const delim = m[2];
    const rest = m[3];
    const markerLen = num.length + 1;
    if (rest === undefined || rest.trim() === '') {
      return { type: 'ordered', delimiter: delim, start: parseInt(num, 10), markerLen, contentIndent: markerLen + 1, canInterruptPara: false };
    }
    let spaces = 0;
    let i = markerLen;
    while (i < content.length && (content[i] === ' ' || content[i] === '\t')) {
      if (content[i] === ' ') spaces++;
      else spaces += 4 - (spaces % 4);
      i++;
    }
    let contentIndent;
    if (spaces >= 5) contentIndent = markerLen + 1;
    else contentIndent = markerLen + spaces;
    return { type: 'ordered', delimiter: delim, start: parseInt(num, 10), markerLen, contentIndent, canInterruptPara: parseInt(num, 10) === 1 };
  }
  return null;
}

// ---- link reference definitions
// Parse one link reference definition starting at `text[pos]`.
// Returns {label, dest, title, end} or null.
function parseLinkReferenceDefinition(text, pos) {
  let i = pos;
  const n = text.length;
  // up to 3 spaces indent
  let spaces = 0;
  while (i < n && text[i] === ' ' && spaces < 3) { i++; spaces++; }
  if (text[i] !== '[') return null;
  // label: [ ... ] (no unescaped [ inside, up to 999 chars)
  const labelRes = parseLinkLabel(text, i);
  if (!labelRes) return null;
  const label = labelRes.label;
  // a label that normalizes to empty is not a definition (cm-552)
  if (normalizeLabel(label) === '') return null;
  i = labelRes.end;
  if (text[i] !== ':') return null;
  i++;
  // optional spaces/tabs/newline + spaces
  i = skipSpacesTabsNewlines(text, i);
  // destination
  const destRes = parseLinkDestination(text, i);
  if (!destRes) return null;
  let dest = destRes.dest;
  i = destRes.end;
  // optional title on same line or next line. A title is only part of the
  // definition when it is followed by nothing but spaces/tabs and the end
  // of its line; an invalid title on the NEXT line does not invalidate the
  // definition (the definition ends after the destination line).
  let title = null;
  let titleEnd = -1;
  let j = i;
  let skipped = 0;
  while (j < n && (text[j] === ' ' || text[j] === '\t')) { j++; skipped++; }
  // a title on the same line must be separated from the destination by
  // whitespace (cm-201: <bar>(baz) is not a definition)
  if (skipped > 0 && j < n && (text[j] === '"' || text[j] === "'" || text[j] === '(')) {
    const t = parseLinkTitle(text, j);
    if (t) {
      let k = t.end;
      while (k < n && (text[k] === ' ' || text[k] === '\t')) k++;
      if (k >= n || text[k] === '\n') { title = t.title; titleEnd = t.end; }
    }
  }
  if (title === null) {
    // try next line (any indent)
    let k = j;
    if (text[k] === '\n') {
      k++;
      while (k < n && (text[k] === ' ' || text[k] === '\t')) k++;
      if (k < n && (text[k] === '"' || text[k] === "'" || text[k] === '(')) {
        const t = parseLinkTitle(text, k);
        if (t) {
          let k2 = t.end;
          while (k2 < n && (text[k2] === ' ' || text[k2] === '\t')) k2++;
          if (k2 >= n || text[k2] === '\n') { title = t.title; titleEnd = t.end; }
        }
      }
    }
  }
  if (title !== null) {
    // definition ends after the title line
    let k = titleEnd;
    while (k < n && (text[k] === ' ' || text[k] === '\t')) k++;
    if (k < n && text[k] === '\n') k++;
    return { label, dest, title, end: k };
  }
  // no title: the destination line must end cleanly
  let k = i;
  while (k < n && (text[k] === ' ' || text[k] === '\t')) k++;
  if (k < n && text[k] !== '\n') return null;
  if (k < n && text[k] === '\n') k++;
  return { label, dest, title: null, end: k };
}

function skipSpacesTabsNewlines(text, i) {
  const n = text.length;
  while (i < n && (text[i] === ' ' || text[i] === '\t')) i++;
  if (text[i] === '\n') {
    i++;
    while (i < n && (text[i] === ' ' || text[i] === '\t')) i++;
  }
  return i;
}

// Parse [label] at text[i]=='['. Returns {label, end} (end = index after ']').
function parseLinkLabel(text, i) {
  const n = text.length;
  if (text[i] !== '[') return null;
  let j = i + 1;
  let label = '';
  while (j < n) {
    const ch = text[j];
    // A backslash escape does not close the label, but the backslash is
    // KEPT in the label value: labels match on raw text (cm-545: [foo\!]
    // does not match [foo!]; cm-194 still matches because both sides
    // carry the same raw \]).
    if (ch === '\\' && j + 1 < n && isPunct(text[j + 1])) { label += text[j] + text[j + 1]; j += 2; continue; }
    if (ch === '[') return null;
    if (ch === ']') {
      if (label.length === 0) return null;
      return { label, end: j + 1 };
    }
    label += ch; j++;
  }
  return null;
}

// Parse a link destination at text[i]. Returns {dest, end} or null.
// Percent-encode a link destination for use in href/src: spaces, backslashes
// and non-ASCII characters become %XX (UTF-8). Existing %XX sequences are
// left alone.
function encodeDest(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (ch === '%' && i + 2 < s.length && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      out += s.slice(i, i + 3);
      i += 2;
      continue;
    }
    if (ch === ' ' || ch === '\\' || ch === '"' || ch === '<' || ch === '>' || ch === '`' || ch === '[' || ch === ']' || code < 32 || code > 127) {
      // UTF-8 percent-encode
      const bytes = new TextEncoder().encode(ch);
      for (const b of bytes) out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
      continue;
    }
    out += ch;
  }
  return out;
}

function parseLinkDestination(text, i) {
  const n = text.length;
  if (i >= n) return null;
  if (text[i] === '<') {
    let j = i + 1;
    let dest = '';
    while (j < n) {
      const ch = text[j];
      if (ch === '\n' || ch === '<') return null;
      if (ch === '>') return { dest: encodeDest(unescapeStr(dest)), end: j + 1 };
      if (ch === '\\' && j + 1 < n && isPunct(text[j + 1])) { dest += text[j + 1]; j += 2; continue; }
      dest += ch; j++;
    }
    return null;
  }
  // bare destination: no spaces, no control chars; balanced parens
  let j = i;
  let dest = '';
  let parens = 0;
  while (j < n) {
    const ch = text[j];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch.charCodeAt(0) < 32) break;
    if (ch === '\\' && j + 1 < n && isPunct(text[j + 1])) { dest += text[j + 1]; j += 2; continue; }
    if (ch === '\\') { dest += '%5C'; j++; continue; }
    if (ch === '(') { parens++; dest += ch; j++; continue; }
    if (ch === ')') {
      if (parens === 0) break;
      parens--; dest += ch; j++; continue;
    }
    dest += ch; j++;
  }
  if (dest.length === 0) return null;
  return { dest: encodeDest(dest), end: j };
}

// Parse a link title at text[i] ('"' or '\'' or '('). Returns {title, end}.
function parseLinkTitle(text, i) {
  const n = text.length;
  const open = text[i];
  const close = open === '(' ? ')' : open;
  let j = i + 1;
  let title = '';
  while (j < n) {
    const ch = text[j];
    if (ch === close) return { title: unescapeStr(title), end: j + 1 };
    if (ch === '\\' && j + 1 < n && isPunct(text[j + 1])) { title += text[j + 1]; j += 2; continue; }
    if (open === '(' && ch === '(') return null;
    title += ch; j++;
  }
  return null;
}

function normalizeLabel(label) {
  // Unicode case folding: ß/ẞ fold to "ss" (cm-540).
  return label.replace(/ß/g, 'ss').replace(/ẞ/g, 'ss').trim().replace(/\s+/g, ' ').toLowerCase();
}

// ---- tables (GFM)
function tryParseTable(lines, parser) {
  // lines[1] must be a delimiter row
  const delim = parseTableDelimiterRow(lines[1]);
  if (!delim) return null;
  const headerCells = splitTableRow(lines[0]);
  if (headerCells === null) return null;
  // the delimiter row must have the same cell count as the header (gfm-203)
  if (delim.length !== headerCells.length) return null;
  const table = blk('table');
  table.align = delim;
  const n = delim.length;
  const headRow = blk('table_row');
  headRow.isHeader = true;
  for (let c = 0; c < n; c++) {
    const cell = blk('table_cell');
    cell.isHeader = true;
    cell.align = delim[c];
    cell.stringContent = (headerCells[c] || '').trim();
    addChild(headRow, cell);
  }
  addChild(table, headRow);
  for (let r = 2; r < lines.length; r++) {
    let rowCells = splitTableRow(lines[r]);
    // a body row without pipes is a single-cell row (gfm-202)
    if (rowCells === null) rowCells = [lines[r]];
    const row = blk('table_row');
    for (let c = 0; c < n; c++) {
      const cell = blk('table_cell');
      cell.align = delim[c];
      cell.stringContent = (rowCells[c] || '').trim();
      addChild(row, cell);
    }
    addChild(table, row);
  }
  return table;
}

function parseTableDelimiterRow(line) {
  const cells = splitTableRow(line);
  if (!cells) return null;
  const aligns = [];
  for (const cell of cells) {
    const t = cell.trim();
    const m = /^(:?)-+(:?)$/.exec(t);
    if (!m) return null;
    if (m[1] === ':' && m[2] === ':') aligns.push('center');
    else if (m[2] === ':') aligns.push('right');
    else if (m[1] === ':') aligns.push('left');
    else aligns.push(null);
  }
  return aligns;
}

// Split a table row on unescaped |. Returns array of cell strings or null
// if the row has no pipe at all.
function splitTableRow(line) {
  if (line.indexOf('|') < 0) return null;
  const cells = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\' && i + 1 < line.length && line[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '|') { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  // drop leading/trailing empty cell from edge pipes
  if (cells.length > 0 && cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells;
}

// ---------------------------------------------------------------- inline parser
//
// Flat scan producing items, then emphasis resolution (CommonMark delimiter
// stack), then tree building. Links use the delimiter stack with the
// "deactivate earlier openers" rule; images use balanced-bracket matching.

const PUNCT_OR_SPACE = /[\s!"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~]/;

function flanking(text, i, len) {
  // char before the run and char after it (in the raw source)
  const before = i > 0 ? text[i - 1] : '';
  const after = i + len < text.length ? text[i + len] : '';
  const beforeIsSpace = before === '' || /\s/.test(before);
  const afterIsSpace = after === '' || /\s/.test(after);
  const beforeIsPunct = before !== '' && isPunctUni(before);
  const afterIsPunct = after !== '' && isPunctUni(after);
  const leftFlanking = !afterIsSpace && (!afterIsPunct || beforeIsSpace || beforeIsPunct);
  const rightFlanking = !beforeIsSpace && (!beforeIsPunct || afterIsSpace || afterIsPunct);
  return { leftFlanking, rightFlanking };
}

// find the closing bracket matching the '[' at text[start], balanced.
// Returns index of the matching ']' or -1.
function findClosingBracket(text, start) {
  let level = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '[') level++;
    else if (ch === ']') {
      level--;
      if (level === 0) return i;
    }
  }
  return -1;
}

// Parse what follows a ']' at position i in text (for inline links/refs).
// Returns {dest, title, end} or null. i points at the char after ']'.
function parseAfterBracket(text, i, refs, linkText) {
  const n = text.length;
  if (i < n && text[i] === '(') {
    // inline link; if it is invalid, fall through to the shortcut
    // reference (cm-568: [foo](not a link) still links via [foo]: /url1)
    let j = skipSpacesTabsNewlinesInline(text, i + 1);
    const destRes = parseLinkDestination(text, j);
    let dest;
    let inlineOk = false;
    if (!destRes) {
      // empty destination: [link]() is valid with href="" (cm-485/487)
      if (j < n && text[j] === ')') { dest = ''; inlineOk = true; }
    } else {
      dest = destRes.dest;
      j = destRes.end;
      inlineOk = true;
    }
    if (inlineOk) {
      let title = null;
      let k = j;
      // skip spaces/tabs (and possibly one newline) before title
      let save = k;
      while (k < n && (text[k] === ' ' || text[k] === '\t')) k++;
      if (k < n && (text[k] === '"' || text[k] === "'" || text[k] === '(')) {
        const t = parseLinkTitle(text, k);
        if (t) { title = t.title; k = t.end; }
      } else {
        // try newline + title
        let k2 = k;
        if (text[k2] === '\n') {
          k2++;
          let sp = 0;
          while (k2 < n && text[k2] === ' ' && sp < 3) { k2++; sp++; }
          if (k2 < n && (text[k2] === '"' || text[k2] === "'" || text[k2] === '(')) {
            const t = parseLinkTitle(text, k2);
            if (t) { title = t.title; k = t.end; }
          }
        }
      }
      k = skipSpacesTabsNewlinesInline(text, k);
      if (k < n && text[k] === ')') return { dest, title, end: k + 1 };
    }
    // inline link invalid: fall through to shortcut reference below
  }
  if (i < n && text[i] === '[') {
    // collapsed reference: [] means use the link text as the label
    if (i + 1 < n && text[i + 1] === ']') {
      const key = normalizeLabel(linkText);
      const ref = refs[key];
      if (!ref) return null;
      return { dest: ref.dest, title: ref.title, end: i + 2 };
    }
    const lab = parseLinkLabel(text, i);
    if (!lab) return null;
    const key = normalizeLabel(lab.label.length === 0 ? linkText : lab.label);
    const ref = refs[key];
    if (!ref) return null;
    return { dest: ref.dest, title: ref.title, end: lab.end };
  }
  // shortcut reference
  const key = normalizeLabel(linkText);
  const ref = refs[key];
  if (!ref) return null;
  return { dest: ref.dest, title: ref.title, end: i };
}

function skipSpacesTabsNewlinesInline(text, i) {
  const n = text.length;
  while (i < n && (text[i] === ' ' || text[i] === '\t')) i++;
  if (text[i] === '\n') {
    i++;
    while (i < n && (text[i] === ' ' || text[i] === '\t')) i++;
  }
  return i;
}

// Try to parse an image starting at text[i] === '!' with text[i+1] === '['.
// Returns {dest, title, altText, end} or null.
function tryParseImage(text, i, refs) {
  const closeIdx = findClosingBracket(text, i + 1);
  if (closeIdx < 0) return null;
  const label = text.slice(i + 2, closeIdx);
  const after = parseAfterBracket(text, closeIdx + 1, refs, label);
  if (!after) return null;
  return { dest: after.dest, title: after.title, label, end: after.end };
}

// Autolink <scheme:...> or <email>
function parseAutolink(text, i) {
  // text[i] === '<'
  const m = /^<([A-Za-z][A-Za-z0-9+.\-]{1,31}:[^<>\s]*)>/.exec(text.slice(i, i + 500));
  if (m) return { dest: encodeDest(m[1]), text: m[1], end: i + m[0].length };
  const m2 = /^<([A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*)>/.exec(text.slice(i, i + 500));
  if (m2) return { dest: 'mailto:' + m2[1], text: m2[1], end: i + m2[0].length };
  return null;
}

// Raw HTML tag (inline)
function parseHtmlTag(text, i) {
  const s = text.slice(i);
  let m = /^<!-->/.exec(s);
  if (m) return { lit: m[0], end: i + m[0].length };
  m = /^<!--->/.exec(s);
  if (m) return { lit: m[0], end: i + m[0].length };
  m = /^<!--(?:(?!-->)[\s\S])*?-->/.exec(s);
  if (m) return { lit: m[0], end: i + m[0].length };
  m = /^<\?(?:(?!\?>)[\s\S])*?\?>/.exec(s);
  if (m) return { lit: m[0], end: i + m[0].length };
  m = /^<![A-Za-z][^>]*>/.exec(s);
  if (m) return { lit: m[0], end: i + m[0].length };
  m = /^<!\[CDATA\[(?:(?!\]\]>)[\s\S])*?\]\]>/.exec(s);
  if (m) return { lit: m[0], end: i + m[0].length };
  // Closing tags take no attributes (cm-624: </a href="foo"> is text).
  m = /^<\/[A-Za-z][A-Za-z0-9-]*\s*>/.exec(s);
  if (m) return { lit: m[0], end: i + m[0].length };
  m = /^<[A-Za-z][A-Za-z0-9-]*(?:\s+[A-Za-z_:][A-Za-z0-9_.:-]*(?:\s*=\s*(?:[^\s"'=<>`]+|'[^']*'|"[^"]*"))?)*\s*\/?>/.exec(s);
  if (m) return { lit: m[0], end: i + m[0].length };
  return null;
}

// Extended autolinks (GFM): www., scheme://, email.
// Returns {dest, text, end} or null. i is the start of the candidate.
function parseExtendedAutolink(text, i) {
  const n = text.length;
  // preceding char must not be alphanumeric (start/space/punct ok)
  if (i > 0) {
    const pc = text[i - 1];
    if (/[A-Za-z0-9]/.test(pc)) return null;
  }
  // email: local@domain
  // www. / scheme://
  let m = /^(www\.)[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*/.exec(text.slice(i, i + 300));
  if (m && /^www\./.test(text.slice(i))) {
    return finishExtUrl(text, i, 'http://', m);
  }
  m = /^([A-Za-z][A-Za-z0-9+.\-]{1,31}):\/\/[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*/.exec(text.slice(i, i + 300));
  if (m) {
    return finishExtUrl(text, i, '', m);
  }
  // scheme autolink (mailto:, xmpp:, tel:, ...). mailto: takes a bare
  // email address (gfm-633: a trailing / is not part of it); xmpp: takes
  // an email plus at most one /resource segment (gfm-635).
  m = /^([A-Za-z][A-Za-z0-9+.\-]{1,31}):/.exec(text.slice(i, i + 300));
  if (m) {
    const scheme = m[1].toLowerCase();
    const rest = text.slice(i + m[0].length, i + 300);
    let url = null;
    if (scheme === 'mailto') {
      const em2 = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*/.exec(rest);
      if (em2) {
        const local = em2[0].split('@')[0];
        const domain = em2[0].split('@')[1];
        const tld = domain.split('.').pop();
        // a following +, -, _ or alnum would extend the address invalidly
        const nx = rest[em2[0].length];
        if (!local.startsWith('.') && !local.endsWith('.') && !local.includes('..') && /^[A-Za-z]+$/.test(tld) && !(nx && /[A-Za-z0-9+_-]/.test(nx))) {
          url = 'mailto:' + em2[0];
        }
      }
      if (!url) return null;
      return { dest: url, text: url, end: i + url.length };
    }
    if (scheme === 'xmpp') {
      const xm = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*(?:\/[^\s<>\/]+)?/.exec(rest);
      if (xm) {
        const local = xm[0].split('@')[0].split('/')[0];
        const domain = xm[0].split('@')[1].split('/')[0];
        const tld = domain.split('.').pop();
        const nx = rest[xm[0].length];
        if (!local.startsWith('.') && !local.endsWith('.') && !local.includes('..') && /^[A-Za-z]+$/.test(tld) && !(nx && /[A-Za-z0-9+_-]/.test(nx))) {
          url = 'xmpp:' + xm[0];
        }
      }
      if (!url) return null;
      return { dest: url, text: url, end: i + url.length };
    }
    // other schemes: non-space chars (stopping at emphasis chars like
    // finishExtUrl, and at backslash, which is not a URL character) with
    // trailing-punctuation trimming. Reject when the trimming leaves only
    // the scheme itself (e.g. "inline:." is a word plus sentence
    // punctuation, not a scheme autolink).
    const gen = /^([A-Za-z][A-Za-z0-9+.\-]{1,31}):[^\s<*_~\\\]]+/.exec(text.slice(i, i + 300));
    if (gen) {
      let u = gen[0];
      const schemeName = gen[1];
      let parens = 0;
      for (const ch of u) { if (ch === '(') parens++; else if (ch === ')') parens--; }
      while (u.length > 0) {
        const last = u[u.length - 1];
        if (last === ')' && parens < 0) { u = u.slice(0, -1); parens++; continue; }
        if (last === ';') {
          const em3 = /&[A-Za-z][A-Za-z0-9]*;$/.exec(u);
          if (em3) { u = u.slice(0, em3.index); continue; }
        }
        if ('?!.,:;'.includes(last)) { u = u.slice(0, -1); continue; }
        break;
      }
      if (u.length === 0 || u === schemeName) return null;
      return { dest: encodeDest(u), text: u, end: i + u.length };
    }
  }
  // email
  const em = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*/.exec(text.slice(i, i + 300));
  if (em) {
    // local part must not start/end with '.' or contain '..'
    const local = em[0].split('@')[0];
    if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
    // the domain's last label must be all letters
    const domain = em[0].split('@')[1];
    const labels = domain.split('.');
    const tld = labels[labels.length - 1];
    if (!/^[A-Za-z]+$/.test(tld)) return null;
    // the match must not be a prefix of a longer (invalid) address:
    // a following +, -, _ or alnum would extend the domain (gfm-631/632)
    const next = text[i + em[0].length];
    if (next && /[A-Za-z0-9+_-]/.test(next)) return null;
    return { dest: 'mailto:' + em[0], text: em[0], end: i + em[0].length };
  }
  return null;
}

function finishExtUrl(text, i, prefix, m) {
  // m[0] is the domain part matched so far; extend with path chars
  let end = i + m[0].length;
  const n = text.length;
  // domain's last label must be all letters, >= 2 chars
  const domain = m[0].replace(/^www\./, '').replace(/^[A-Za-z][A-Za-z0-9+.\-]{1,31}:\/\//, '');
  const labels = domain.split('.');
  const tld = labels[labels.length - 1];
  if (!/^[A-Za-z]{2,}$/.test(tld)) return null;
  // extend over path characters: stop at whitespace, <, *, _, ~, and ]
  // (a ] closes a link label, so a URL inside a label must not swallow it)
  while (end < n) {
    const ch = text[end];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '<' || ch === '*' || ch === '_' || ch === '~' || ch === ']') break;
    end++;
  }
  let url = text.slice(i, end);
  // trim trailing punctuation: ? ! . , : ;
  // and ')' until parens balance; a trailing &name; entity is not part
  // of the URL at all (gfm-627)
  let parens = 0;
  for (const ch of url) { if (ch === '(') parens++; else if (ch === ')') parens--; }
  while (url.length > 0) {
    const last = url[url.length - 1];
    if (last === ')' && parens < 0) { url = url.slice(0, -1); parens++; continue; }
    if (last === ';') {
      const em = /&[A-Za-z][A-Za-z0-9]*;$/.exec(url);
      if (em) { url = url.slice(0, em.index); continue; }
    }
    if ('?!.,:;'.includes(last)) {
      url = url.slice(0, -1); continue;
    }
    break;
  }
  if (url.length === 0) return null;
  // The href is the percent-encoded destination (backslash -> %5C, etc.);
  // the link text keeps the raw URL.
  return { dest: prefix + encodeDest(url), text: url, end: i + url.length };
}

function parseInline(text, refs) {
  const items = []; // flat items
  const delims = []; // delimiter items (references into items)
  const bracketStack = []; // open bracket items
  let i = 0;
  const n = text.length;

  function pushText(s, noMerge) {
    if (s === '') return;
    const last = items[items.length - 1];
    if (last && last.t === 'text' && !last.noMerge) last.lit += s;
    else items.push({ t: 'text', lit: s, noMerge: !!noMerge });
  }

  while (i < n) {
    const ch = text[i];
    if (ch === '\n') {
      // hard break if preceded by 2+ spaces or a backslash (backslash handled
      // in the escape branch below, so here only spaces matter)
      const last = items[items.length - 1];
      if (last && last.t === 'text' && /  +$/.test(last.lit)) {
        last.lit = last.lit.replace(/ +$/, '');
        items.push({ t: 'br' });
      } else {
        items.push({ t: 'sb' });
      }
      i++;
      continue;
    }
    if (ch === '\\') {
      if (i + 1 < n && text[i + 1] === '\n') {
        items.push({ t: 'br' });
        i += 2;
        continue;
      }
      if (i + 1 < n && isPunct(text[i + 1])) {
        // an escaped & must not merge with following text (it would form a
        // false entity like &ouml;); same for a decoded & below
        pushText(text[i + 1], text[i + 1] === '&');
        i += 2; continue;
      }
      pushText('\\'); i++;
      continue;
    }
    if (ch === '`') {
      // code span
      let run = 0;
      while (i + run < n && text[i + run] === '`') run++;
      // find a closing run of exactly `run` backticks
      let j = i + run;
      let close = -1;
      while (j < n) {
        if (text[j] === '`') {
          let r2 = 0;
          while (j + r2 < n && text[j + r2] === '`') r2++;
          if (r2 === run) { close = j; break; }
          j += r2;
        } else j++;
      }
      if (close >= 0) {
        let content = text.slice(i + run, close);
        content = content.replace(/\n/g, ' ');
        if (content.length >= 2 && content[0] === ' ' && content[content.length - 1] === ' ' && !/^[ ]+$/.test(content)) {
          content = content.slice(1, -1);
        }
        items.push({ t: 'code', lit: content });
        i = close + run;
      } else {
        pushText('`'.repeat(run));
        i += run;
      }
      continue;
    }
    if (ch === '&') {
      const dec = decodeNumericRef(text, i);
      if (dec) { pushText(dec[0], dec[0] === '&'); i += dec[1]; continue; }
      pushText('&'); i++;
      continue;
    }
    if (ch === '<') {
      const auto = parseAutolink(text, i);
      if (auto) {
        // explicit <...> autolink: stays a link even inside link text
        // (marked nests it); only bare-URL autolinks are flattened
        items.push({ t: 'link', dest: auto.dest, title: null, explicit: true, children: [{ t: 'text', lit: auto.text }] });
        i = auto.end;
        continue;
      }
      const tag = parseHtmlTag(text, i);
      if (tag) { items.push({ t: 'html', lit: tag.lit }); i = tag.end; continue; }
      pushText('<'); i++;
      continue;
    }
    if (ch === '!' && text[i + 1] === '[') {
      const img = tryParseImage(text, i, refs);
      if (img) {
        const altNodes = parseInline(img.label, refs);
        const alt = plainText(altNodes);
        items.push({ t: 'image', dest: img.dest, title: img.title, alt });
        i = img.end;
        continue;
      }
      pushText('!'); i++;
      continue;
    }
    if (ch === '[') {
      const open = { t: 'open', active: true, srcPos: i, dest: null, title: null };
      items.push(open);
      bracketStack.push(open);
      i++;
      continue;
    }
    if (ch === ']') {
      // find nearest active opener
      let open = null;
      for (let k = bracketStack.length - 1; k >= 0; k--) {
        if (bracketStack[k].active) { open = bracketStack[k]; break; }
      }
      if (open) {
        const linkText = text.slice(open.srcPos + 1, i);
        const after = parseAfterBracket(text, i + 1, refs, linkText);
        if (after) {
          open.dest = after.dest;
          open.title = after.title;
          const close = { t: 'close', open };
          open._close = close;
          items.push(close);
          // deactivate all openers before this one, and remove this
          // opener from the stack (it is used up; cm-518: a later ]
          // must not reuse it to swallow the trailing (/uri))
          for (const o of bracketStack) {
            if (o === open) break;
            o.active = false;
          }
          const oi = bracketStack.indexOf(open);
          if (oi >= 0) bracketStack.splice(oi, 1);
          i = after.end;
          continue;
        }
        // No link formed: this opener can no longer form a link (cm-513).
        open.active = false;
      }
      pushText(']'); i++;
      continue;
    }
    if (ch === '*' || ch === '_' || ch === '~') {
      let run = 0;
      while (i + run < n && text[i + run] === ch) run++;
      const fl = flanking(text, i, run);
      let canOpen, canClose;
      if (ch === '*') { canOpen = fl.leftFlanking; canClose = fl.rightFlanking; }
      else if (ch === '~') { canOpen = fl.leftFlanking; canClose = fl.rightFlanking; }
      else {
        const beforePunct = i > 0 && isPunctUni(text[i - 1]);
        const afterPunct = i + run < n && isPunctUni(text[i + run]);
        canOpen = fl.leftFlanking && (!fl.rightFlanking || beforePunct);
        canClose = fl.rightFlanking && (!fl.leftFlanking || afterPunct);
      }
      const d = { t: 'delim', ch, len: run, canOpen, canClose };
      items.push(d);
      delims.push(d);
      i += run;
      continue;
    }
    // extended autolinks (www. / scheme:// / email) at word starts.
    // These may form inside a link label; if the outer [...](...) link
    // then forms, buildInlineTree flattens the inner autolink back to
    // text (link text cannot contain a link). If the outer link does
    // not form, the autolink stands.
    if ((ch === 'w' && text.startsWith('www.', i)) ||
      (/[A-Za-z]/.test(ch))) {
      const ext = parseExtendedAutolink(text, i);
      if (ext) {
        items.push({ t: 'link', dest: ext.dest, title: null, children: [{ t: 'text', lit: ext.text }] });
        i = ext.end;
        continue;
      }
    }
    pushText(ch);
    i++;
  }

  processEmphasis(items, delims);
  return buildInlineTree(items);
}

// ---- emphasis resolution (CommonMark delimiter stack algorithm) ----
function processEmphasis(items, delims) {
  // delims is the list of delimiter items; we process closers in order.
  let current = 0; // index into delims
  function itemIndex(d) { return items.indexOf(d); }

  // Does the range (oi, ci) in `items` cross a link boundary (an open whose
  // close lies at/after ci, or a close whose open lies at/before oi)?
  function crossesLink(oi, ci) {
    for (let k = oi + 1; k < ci; k++) {
      const it = items[k];
      if (it.t === 'open' && it.dest !== null && it._close && items.indexOf(it._close) >= ci) return true;
      if (it.t === 'close' && items.indexOf(it.open) <= oi) return true;
    }
    return false;
  }

  while (current < delims.length) {
    const closer = delims[current];
    if (!closer || closer.len === 0 || !closer.canClose) { current++; continue; }
    // look back for the first usable opener with the same char
    let opener = null;
    for (let k = current - 1; k >= 0; k--) {
      const d = delims[k];
      if (!d || d.len === 0) continue;
      if (d.ch !== closer.ch) continue;
      if (!d.canOpen) continue;
      // odd match rule
      const oddMatch = (d.canClose || closer.canOpen) &&
        ((d.len + closer.len) % 3 === 0) &&
        (d.len % 3 !== 0 || closer.len % 3 !== 0);
      if (oddMatch) continue;
      // strikethrough: runs of 1-2 tildes form <del>; 3+ do not (gfm-491/493)
      if (closer.ch === '~' && (d.len >= 3 || closer.len >= 3)) continue;
      const oi = itemIndex(d);
      const ci = itemIndex(closer);
      if (oi < 0 || ci < 0 || oi >= ci) continue;
      if (crossesLink(oi, ci)) continue;
      opener = d;
      break;
    }
    if (!opener) { current++; continue; }
    const use = closer.ch === '~' ? ((opener.len >= 2 && closer.len >= 2) ? 2 : 1) : ((opener.len >= 2 && closer.len >= 2) ? 2 : 1);
    const type = closer.ch === '~' ? 'del' : (use === 2 ? 'strong' : 'em');
    const oi = itemIndex(opener);
    const ci = itemIndex(closer);
    if (oi < 0 || ci < 0 || oi >= ci) { current++; continue; }
    wrapRange(items, oi, ci, type);
    // adjust delimiter lengths
    opener.len -= use;
    closer.len -= use;
    if (opener.len === 0) {
      const di = delims.indexOf(opener);
      if (di >= 0) delims.splice(di, 1);
      const ii = items.indexOf(opener);
      if (ii >= 0) items.splice(ii, 1);
      if (di >= 0 && di < current) current--;
    }
    if (closer.len === 0) {
      const di = delims.indexOf(closer);
      if (di >= 0) delims.splice(di, 1);
      const ii = items.indexOf(closer);
      if (ii >= 0) items.splice(ii, 1);
      // current now points at the next delimiter
    }
    // if the closer still has delimiters left, current stays: it may match
    // another opener on the next iteration
  }
}

// Wrap items strictly between items[oi] and items[ci] into a node of `type`.
// The range never crosses a link boundary (checked by the caller), so the
// items between are balanced and no link splitting is needed.
function wrapRange(items, oi, ci, type) {
  const between = items.slice(oi + 1, ci);
  const node = { t: type, children: between };
  items.splice(oi + 1, ci - oi - 1, node);
}

// ---- build the inline tree from flat items ----
// A link inside link text is not allowed: flatten it to its plain text
// (its children, recursively). Images are kept (they may appear in
// link text). Applied whenever a bracket link forms, so an autolink
// inside the label becomes plain text of the outer link, while an
// autolink in a label that never forms a link stays a link. Explicit
// <...> autolinks are NOT flattened (marked nests them).
function flattenLinks(nodes) {
  const out = [];
  for (const nd of nodes) {
    if (nd.t === 'link' && !nd.explicit) {
      out.push(...flattenLinks(nd.children || []));
    } else if (nd.t === 'em' || nd.t === 'strong' || nd.t === 'del') {
      out.push({ t: nd.t, children: flattenLinks(nd.children || []) });
    } else {
      out.push(nd);
    }
  }
  return out;
}

function buildInlineTree(items) {
  const out = [];
  let k = 0;
  while (k < items.length) {
    const it = items[k];
    if (it.t === 'open' && it.dest !== null) {
      // collect until matching close
      const children = [];
      let depth = 1;
      k++;
      let closed = false;
      while (k < items.length) {
        const it2 = items[k];
        if (it2.t === 'open' && it2.dest !== null) depth++;
        if (it2.t === 'close') {
          depth--;
          if (depth === 0) { closed = true; k++; break; }
        }
        children.push(it2);
        k++;
      }
      if (!closed) {
        // unbalanced: treat the opener as literal text
        out.push({ t: 'text', lit: '[' });
        out.push(...buildInlineTree(children));
        continue;
      }
      out.push({ t: 'link', dest: it.dest, title: it.title, children: buildInlineTree(flattenLinks(children)) });
      continue;
    }
    if (it.t === 'close') { out.push({ t: 'text', lit: ']' }); k++; continue; }
    if (it.t === 'open') { out.push({ t: 'text', lit: '[' }); k++; continue; }
    if (it.t === 'delim') {
      if (it.len > 0) out.push({ t: 'text', lit: it.ch.repeat(it.len) });
      k++; continue;
    }
    if (it.t === 'em' || it.t === 'strong' || it.t === 'del') {
      out.push({ t: it.t, children: buildInlineTree(it.children) });
      k++; continue;
    }
    out.push(it);
    k++;
  }
  return out;
}

// ---------------------------------------------------------------- rendering

// Plain-text content of inline nodes (for image alt text): a nested
// image contributes its own alt text, a link/emphasis its children.
function plainText(nodes) {
  let out = '';
  for (const node of nodes) {
    switch (node.t) {
      case 'text': out += node.lit; break;
      case 'code': out += node.lit; break;
      case 'image': out += node.alt; break;
      case 'link':
      case 'em':
      case 'strong':
      case 'del': out += plainText(node.children); break;
      default: break;
    }
  }
  return out;
}

function renderInline(nodes) {
  let out = '';
  for (const node of nodes) {
    switch (node.t) {
      case 'text': out += escapeText(node.lit); break;
      case 'code': out += '<code>' + escapeCode(node.lit) + '</code>'; break;
      case 'html': out += node.lit; break;
      case 'br': out += '<br>'; break;
      case 'sb': out += '\n'; break;
      case 'em': out += '<em>' + renderInline(node.children) + '</em>'; break;
      case 'strong': out += '<strong>' + renderInline(node.children) + '</strong>'; break;
      case 'del': out += '<del>' + renderInline(node.children) + '</del>'; break;
      case 'link': {
        let s = '<a href="' + escapeAttr(node.dest) + '"';
        if (node.title != null) s += ' title="' + escapeAttr(node.title) + '"';
        s += '>' + renderInline(node.children) + '</a>';
        out += s;
        break;
      }
      case 'image': {
        let s = '<img src="' + escapeAttr(node.dest) + '" alt="' + escapeAttr(node.alt) + '"';
        if (node.title != null) s += ' title="' + escapeAttr(node.title) + '"';
        s += '>';
        out += s;
        break;
      }
    }
  }
  return out;
}

function renderBlock(node, tightParent) {
  switch (node.t) {
    case 'document': {
      let out = '';
      for (const c of node.children) out += renderBlock(c, false);
      return out;
    }
    case 'paragraph': {
      const inner = renderInline(node.inline || []);
      if (tightParent) return inner;
      return '<p>' + inner + '</p>\n';
    }
    case 'heading':
      return '<h' + node.level + '>' + renderInline(node.inline || []) + '</h' + node.level + '>\n';
    case 'thematic_break':
      return '<hr>\n';
    case 'code_block': {
      let s = '<pre><code';
      if (node.fenced && node.info) {
        const lang = unescapeStr(node.info.split(/\s+/)[0]);
        s += ' class="language-' + escapeAttr(lang) + '"';
      }
      s += '>' + escapeCode(node.literal || '') + '</code></pre>\n';
      return s;
    }
    case 'html_block':
      return node.literal || '';
    case 'blockquote': {
      let out = '<blockquote>\n';
      for (const c of node.children) out += renderBlock(c, false);
      out += '</blockquote>\n';
      return out;
    }
    case 'list': {
      const tag = node.listType === 'ordered' ? 'ol' : 'ul';
      let s = '<' + tag;
      if (node.listType === 'ordered' && node.start !== 1) s += ' start="' + node.start + '"';
      s += '>\n';
      for (const item of node.children) s += renderBlock(item, false);
      s += '</' + tag + '>\n';
      return s;
    }
    case 'item': {
      const list = node.parent;
      const tight = list ? list.tight : true;
      let s = '<li>';
      const kids = node.children;
      // In a loose list the checkbox goes INSIDE the first paragraph's <p>
      // (marked renders <li><p><input ...> text</p>); in a tight list it
      // precedes the inline content.
      if (node.task && !tight && kids.length > 0 && kids[0].t === 'paragraph') {
        const cb = node.task === 'checked'
          ? '<input checked="" disabled="" type="checkbox">'
          : '<input disabled="" type="checkbox">';
        s += '<p>' + cb + renderInline(kids[0].inline || []) + '</p>\n';
        for (let i = 1; i < kids.length; i++) {
          s += renderBlock(kids[i], false);
        }
        s += '</li>\n';
        return s;
      }
      if (node.task) {
        s += node.task === 'checked'
          ? '<input checked="" disabled="" type="checkbox">'
          : '<input disabled="" type="checkbox">';
      }
      for (let i = 0; i < kids.length; i++) {
        const child = kids[i];
        if (child.t === 'paragraph' && tight) {
          // tight paragraph: inline content only, no trailing newline,
          // even when another block follows
          s += renderInline(child.inline || []);
        } else {
          s += renderBlock(child, false);
        }
      }
      s += '</li>\n';
      return s;
    }
    case 'table': {
      let s = '<table>\n<thead>\n';
      const head = node.children[0];
      s += '<tr>\n';
      for (const cell of head.children) {
        s += '<th' + (cell.align ? ' align="' + cell.align + '"' : '') + '>' + renderInline(cell.inline || []) + '</th>\n';
      }
      s += '</tr>\n</thead>\n';
      if (node.children.length > 1) {
        s += '<tbody>';
        for (let r = 1; r < node.children.length; r++) {
          const row = node.children[r];
          s += '<tr>\n';
          for (const cell of row.children) {
            s += '<td' + (cell.align ? ' align="' + cell.align + '"' : '') + '>' + renderInline(cell.inline || []) + '</td>\n';
          }
          s += '</tr>\n';
        }
        s += '</tbody>';
      }
      s += '</table>\n';
      return s;
    }
    default:
      return '';
  }
}

// Task-list checkboxes: detect "[ ]"/"[x]" at the start of a list item's
// first paragraph and strip it, recording the state on the item.
function processTasks(node, refs) {
  if (node.t === 'item') {
    const first = node.children[0];
    if (first && first.t === 'paragraph' && first.lines && first.lines.length > 0) {
      const m = /^\[([ xX])\](?:[ \t]+(.*))?$/.exec(first.lines[0]);
      if (m) {
        node.task = (m[1] === ' ' ? 'unchecked' : 'checked');
        // keep one space after the checkbox (gfm-279/280)
        first.lines[0] = m[2] === undefined ? '' : ' ' + m[2];
        first.stringContent = first.lines.join('\n');
        first.inline = parseInline(first.stringContent, refs);
      }
    }
  }
  for (const c of node.children) processTasks(c, refs);
}

export function parse(markdown) {
  const parser = new BlockParser();
  const doc = parser.parse(markdown);
  processTasks(doc, parser.refs);
  return renderBlock(doc, false);
}
