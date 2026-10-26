const test = require('node:test');
const assert = require('node:assert');
const { parseNotes, mapToSlides } = require('../src/notes');

test('numbered ## headings after a # title', () => {
  const md = `# Deck notes\n\nIntro table\n\n## 1. Welcome\n\n*About 0:45 · ends at 0:45*\n\nHello.\n\n## 2. Agenda\n\n*About 1:00 · ends at 1:45*\n\nFour parts.\n`;
  const { preamble, sections } = parseNotes(md);
  assert.match(preamble, /Intro table/);
  assert.equal(sections.length, 2);
  assert.deepEqual([sections[0].number, sections[0].title], [1, 'Welcome']);
  assert.equal(sections[1].duration, 60);
  assert.equal(sections[1].endsAt, 105);
  const map = mapToSlides(sections);
  assert.equal(map[1].title, 'Agenda');
});

test('unnumbered headings map in order, ids map by slide id', () => {
  const md = `## Opening\nA\n## #agenda Plan\nB\n## Closing\nC\n`;
  const { sections } = parseNotes(md);
  const map = mapToSlides(sections, ['cover', 'x', 'agenda', 'end']);
  assert.equal(map[0].body, 'A');
  assert.equal(map[2].body, 'B');
  assert.equal(map[3].body, 'C');
});

test('--- separated notes without headings', () => {
  const { sections } = parseNotes('one\n---\ntwo\n---\nthree');
  assert.deepEqual(sections.map(s => s.body), ['one', 'two', 'three']);
});

test('ends-at is derived from durations when missing', () => {
  const { sections } = parseNotes('## 1. A\nabout 1:00\n## 2. B\nabout 0:30\n');
  assert.deepEqual(sections.map(s => s.endsAt), [60, 90]);
});

test('headings inside code fences are ignored', () => {
  const { sections } = parseNotes('## 1. A\n```\n## not a slide\n```\n## 2. B\nx\n');
  assert.equal(sections.length, 2);
});
