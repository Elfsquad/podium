// Parses a Markdown speaker-notes file into one entry per slide.
//
// Supported layouts:
//   1. Headings, one per slide. The heading level used is the smallest level (#, ##, ###) that occurs
//      at least twice, so a single "# Title" on top is treated as a preamble.
//      "## 5. Some title" or "## 5 - Some title" maps to slide 5. "## #cover Some title" maps to the slide
//      whose element id is "cover". Headings without either are mapped in order.
//   2. No headings: sections separated by a line containing only "---", mapped in order.
//
// Timing lines such as "*About 1:45 · ends at 5:00*" are picked up for the pace indicator.

const fs = require('fs');
const path = require('path');

function toSeconds(mmss) {
  const parts = mmss.split(':').map(Number);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function parseTiming(body) {
  const about = body.match(/\babout\s+(\d{1,2}:\d{2}(?::\d{2})?)/i);
  const ends = body.match(/\bends at\s+(\d{1,2}:\d{2}(?::\d{2})?)/i);
  return {
    duration: about ? toSeconds(about[1]) : null,
    endsAt: ends ? toSeconds(ends[1]) : null,
  };
}

// Remove fenced code so headings inside code blocks are not treated as sections.
function headingLines(lines) {
  const out = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) return;
    const m = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
    if (m) out.push({ line: i, level: m[1].length, text: m[2] });
  });
  return out;
}

function parseHeading(text) {
  let m = text.match(/^(?:slide\s*)?(\d+)\s*[.):\-–—]?\s+(.*)$/i) || text.match(/^(?:slide\s*)?(\d+)$/i);
  if (m) return { number: Number(m[1]), id: null, title: (m[2] || '').trim() };
  m = text.match(/^#([\w-]+)\s*(.*)$/);
  if (m) return { number: null, id: m[1], title: m[2].trim() || m[1] };
  return { number: null, id: null, title: text.trim() };
}

function parseNotes(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const heads = headingLines(lines);

  let level = null;
  for (const l of [1, 2, 3]) {
    if (heads.filter(h => h.level === l).length >= 2) { level = l; break; }
  }

  const sections = [];
  let preamble = '';

  if (level) {
    const marks = heads.filter(h => h.level === level);
    preamble = lines.slice(0, marks[0].line).join('\n').trim();
    marks.forEach((h, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].line : lines.length;
      const body = lines.slice(h.line + 1, end).join('\n').trim();
      sections.push({ ...parseHeading(h.text), heading: h.text, body });
    });
  } else {
    const chunks = [];
    let cur = [];
    for (const line of lines) {
      if (/^\s*---+\s*$/.test(line)) { chunks.push(cur.join('\n')); cur = []; } else cur.push(line);
    }
    chunks.push(cur.join('\n'));
    chunks.map(c => c.trim()).filter(Boolean).forEach(body => {
      sections.push({ number: null, id: null, title: '', heading: '', body });
    });
  }

  // Fill in timing; derive missing "ends at" from cumulative durations.
  let clock = 0;
  for (const s of sections) {
    const t = parseTiming(s.body);
    s.duration = t.duration;
    if (t.endsAt != null) clock = t.endsAt;
    else if (t.duration != null) clock += t.duration;
    s.endsAt = (t.endsAt != null || t.duration != null) ? clock : null;
  }

  return { preamble, sections };
}

// Assign sections to slide indexes. `slideIds` is the list of element ids from the deck (may be empty).
function mapToSlides(sections, slideIds = []) {
  const byIndex = {};
  let next = 0;
  for (const s of sections) {
    let idx = null;
    if (s.number != null) idx = s.number - 1;
    else if (s.id != null) {
      const found = slideIds.indexOf(s.id);
      if (found >= 0) idx = found;
    }
    if (idx == null) idx = next;
    if (byIndex[idx] == null) byIndex[idx] = s;
    next = idx + 1;
  }
  return byIndex;
}

// Pick a notes file for a deck: a .md next to it whose name mentions notes, or the only .md there.
function findNotesFor(deckPath) {
  const dir = path.dirname(deckPath);
  let files;
  try { files = fs.readdirSync(dir).filter(f => /\.(md|markdown)$/i.test(f) && !/^readme\./i.test(f)); } catch { return null; }
  if (!files.length) return null;
  const base = path.basename(deckPath).replace(/\.html?$/i, '').toLowerCase();
  const pick = files.find(f => f.toLowerCase().startsWith(base) && /notes/i.test(f))
    || files.find(f => /notes/i.test(f))
    || (files.length === 1 ? files[0] : null);
  return pick ? path.join(dir, pick) : null;
}

module.exports = { parseNotes, mapToSlides, findNotesFor, toSeconds };
