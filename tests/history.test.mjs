import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createHistory,
  currentDocument,
  stageHistory,
  commitHistory,
  jumpHistory,
  moveNode,
} from '../lib/history.mjs';
import { paletteFromPrimary, extractPalette } from '../lib/palette.mjs';
const source = {
  sourceId: 'a',
  canvas: { ratio: 'original' },
  nodes: [
    { id: 'first', params: { exposure: 0 } },
    { id: 'second', params: {} },
  ],
};
test('a continuous gesture commits once and restores exact settings on undo/redo', () => {
  let history = createHistory(source);
  for (let value = 1; value <= 100; value++)
    history = stageHistory(
      history,
      {
        ...source,
        nodes: [
          { ...source.nodes[0], params: { exposure: value } },
          source.nodes[1],
        ],
      },
      'exposure',
    );
  assert.equal(history.entries.length, 1);
  history = commitHistory(history);
  assert.equal(history.entries.length, 2);
  assert.equal(
    currentDocument(jumpHistory(history, 0)).nodes[0].params.exposure,
    0,
  );
  assert.equal(
    currentDocument(jumpHistory(history, 1)).nodes[0].params.exposure,
    100,
  );
  assert.equal(
    commitHistory(
      stageHistory(history, structuredClone(currentDocument(history)), 'no-op'),
    ).entries.length,
    2,
  );
});
test('editing after undo removes redo without mutating earlier documents', () => {
  let history = createHistory(source);
  history = commitHistory(
    stageHistory(history, { ...source, sourceId: 'b' }, 'replace source'),
  );
  history = commitHistory(
    stageHistory(
      history,
      { ...currentDocument(history), canvas: { ratio: '9:16' } },
      'ratio',
    ),
  );
  history = jumpHistory(history, 1);
  history = commitHistory(
    stageHistory(
      history,
      moveNode(currentDocument(history), 'second', -1),
      'reorder',
    ),
  );
  assert.equal(history.entries.length, 3);
  assert.equal(currentDocument(history).canvas.ratio, 'original');
  assert.deepEqual(
    currentDocument(history).nodes.map((n) => n.id),
    ['second', 'first'],
  );
  assert.deepEqual(
    source.nodes.map((n) => n.id),
    ['first', 'second'],
  );
  assert.equal(currentDocument(jumpHistory(history, 0)).sourceId, 'a');
  assert.equal(currentDocument(jumpHistory(history, 1)).sourceId, 'b');
});
test('history has no hard step cap and supports direct jumps', () => {
  let history = createHistory(source);
  for (let i = 0; i < 1200; i++)
    history = commitHistory(
      stageHistory(history, { ...source, sourceId: String(i) }, 'replace'),
    );
  assert.equal(history.entries.length, 1201);
  assert.equal(currentDocument(jumpHistory(history, 17)).sourceId, '16');
});
test('primary and source palettes generate ordered tones, ignoring transparent pixels', () => {
  const palette = paletteFromPrimary('#9060e0');
  assert.equal(palette.color, '#9060e0');
  assert.notEqual(palette.middle, palette.background);
  const data = new Uint8ClampedArray([
    200, 20, 10, 0, 30, 70, 150, 255, 30, 70, 150, 255, 0, 0, 0, 255,
  ]);
  const extracted = extractPalette(data);
  const values = Object.values(extracted).map((hex) =>
    [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16))
      .reduce((a, b) => a + b),
  );
  assert.ok(values[0] > values[1] && values[1] > values[2]);
  assert.ok(
    parseInt(extracted.color.slice(5), 16) >
      parseInt(extracted.color.slice(1, 3), 16),
  );
});
