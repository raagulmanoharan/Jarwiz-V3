/**
 * Headless round-trip check for the doc markdown ↔ editor bridge (ui/docBridge).
 * Verifies that editing a doc can't silently rewrite it: for representative
 * content, docToMd(mdToDoc(md)) reproduces the markdown, and a second pass is
 * idempotent (stable — no drift on repeated edits). Run: npx tsx scripts/eval-docbridge.ts
 */
import { mdToDoc, docToMd, docHasSpecialSyntax } from '../apps/web/src/ui/docBridge.ts';

let failures = 0;
const roundtrip = (md: string) => docToMd(mdToDoc(md));

function expectStable(name: string, md: string) {
  const once = roundtrip(md);
  const twice = roundtrip(once);
  const ok = once === md && twice === once;
  if (!ok) {
    failures++;
    console.log(`✗ ${name}`);
    if (once !== md) console.log(`  round-trip changed the content:\n  in : ${JSON.stringify(md)}\n  out: ${JSON.stringify(once)}`);
    if (twice !== once) console.log(`  NOT idempotent (drifts on re-edit):\n  1st: ${JSON.stringify(once)}\n  2nd: ${JSON.stringify(twice)}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

function expect(name: string, cond: boolean) {
  if (!cond) { failures++; console.log(`✗ ${name}`); } else { console.log(`✓ ${name}`); }
}

expectStable('headings + paragraph', '# Title\n\n## Sub\n\nA plain paragraph.');
expectStable('inline marks', 'This is **bold**, *italic*, __underline__, ~~strike~~ and `code`.');
expectStable('bullet list', '- first\n- second\n- third');
expectStable('task list', '- [ ] todo\n- [x] done');
expectStable('table with header', '| Name | Role |\n| --- | --- |\n| Ada | Eng |\n| Bo | Design |');
expectStable('link + bare url', 'See [the docs](https://example.com/guide) or https://jarwiz.app here.');
expectStable('image', '![a cat](https://example.com/cat.png)');
expectStable('divider between paras', 'Above the line.\n\n---\n\nBelow the line.');
expectStable('multi-paragraph prose', 'First para.\n\nSecond para.\n\nThird para.');
expectStable('mixed doc', '# Report\n\nIntro **paragraph** with a [link](https://x.com).\n\n## Findings\n\n- point one\n- point two\n\n| Metric | Value |\n| --- | --- |\n| Speed | Fast |');

// ── Complex permutations — nested/mixed formatting in every position ──────────
expectStable('bold inside heading', '## A **bold** heading and more');
expectStable('mixed marks in heading', '# *Italic* and `code` in a title');
expectStable('link inside list item', '- see [the docs](https://example.com/x)');
expectStable('bold + link in list item', '- **important**: read [this](https://example.com/y)');
expectStable('task with formatting', '- [ ] finish **the report** by [friday](https://cal.com/f)\n- [x] ~~old task~~ done');
expectStable('formatted table cells', '| Name | Link |\n| --- | --- |\n| **Ada** | [site](https://ada.dev) |\n| *Bo* | `code` |');
expectStable('image in a list item', '- ![logo](https://example.com/logo.png) our brand');
expectStable('multiple links in a line', 'Both [one](https://a.com/1) and [two](https://b.com/2) apply.');
expectStable('heading then table then list', '## Data\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- note one\n- note two');
expectStable('numbered list survives', '1. first\n2. second\n3. third');
expectStable('everything at once', '# Title\n\nIntro with **bold**, *italic*, __underline__, a [link](https://x.com/z) and `code`.\n\n## Table\n\n| Feature | Status |\n| --- | --- |\n| **Fast** | [done](https://x.com/d) |\n\n## Checklist\n\n- [x] **shipped**\n- [ ] pending *review*');

// Fallback detection — dialect-only docs must NOT go through the rich editor.
expect('detect map fence', docHasSpecialSyntax('Some text\n```map\n{}\n```'));
expect('detect widget fence', docHasSpecialSyntax('```widget\n{}\n```'));
expect('detect page citation', docHasSpecialSyntax('As shown [p.3] in the source.'));
expect('plain doc is not special', !docHasSpecialSyntax('# Just a heading\n\nAnd prose.'));

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
