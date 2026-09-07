import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transform } from 'esbuild';
import { packPreset, validatePreset, presetAssetIds } from '../lib/presets.mjs';
const module = { exports: {} };
const compiled = await transform(
  fs.readFileSync(new URL('../lib/editor.ts', import.meta.url), 'utf8'),
  { loader: 'ts', format: 'cjs' },
);
vm.runInNewContext(compiled.code, { module, exports: module.exports, crypto });
const { FILTERS, blankDocument, makeNode } = module.exports;
const encoded = new Map([
  ['private-sticker-id', { mime: 'image/png', data: 'YWJjZA==' }],
]);
const document = () => ({
  ...blankDocument(),
  sourceId: 'private-original-id',
  nodes: Object.keys(FILTERS).map((type) => {
    const node = makeNode(type);
    if ('assetId' in node.params) node.params.assetId = 'private-sticker-id';
    return node;
  }),
});
const serialize = (value) => JSON.parse(JSON.stringify(value));
test('preset round trip preserves every catalog default and deduplicates disabled layer assets without the source', () => {
  const doc = document();
  doc.nodes.find((n) => n.type === 'sticker').enabled = false;
  doc.output.ratio = '3:2';
  doc.output.fit = 'stretch';
  doc.nodes.push({
    ...makeNode('sticker'),
    params: {
      ...FILTERS.sticker.defaults,
      opacity: 50,
      assetId: 'private-sticker-id',
    },
  });
  const packed = packPreset(doc, encoded),
    json = JSON.stringify(packed),
    imported = validatePreset(serialize(packed), FILTERS);
  assert.equal(json.includes('private-original-id'), false);
  assert.equal(json.includes('private-sticker-id'), false);
  assert.equal(json.includes('sourceId'), false);
  for (const n of doc.nodes) assert.equal(json.includes(n.id), false);
  assert.equal(Object.keys(imported.assets).length, 1);
  assert.deepEqual(presetAssetIds(imported), ['asset-1']);
  assert.deepEqual(serialize(imported.nodes), serialize(packed.nodes));
  assert.equal(imported.output.ratio, '3:2');
  assert.equal(imported.output.fit, 'stretch');
  assert.equal(imported.nodes.find((n) => n.type === 'sticker').enabled, false);
});
test('presets validate number boundaries, types, colors, choices and missing assets', () => {
  for (const [type, definition] of Object.entries(FILTERS))
    for (const field of definition.fields.filter((f) => f.kind === 'number')) {
      for (const value of [field.min ?? 0, field.max ?? 100]) {
        const doc = document(),
          node = doc.nodes.find((n) => n.type === type);
        node.params[field.key] = value;
        if (type === 'dither' && field.key === 'start')
          node.params.fadeEnd = 100;
        if (type === 'dither' && field.key === 'fadeEnd') node.params.start = 0;
        if (type === 'dither' && node.params.start >= node.params.fadeEnd)
          continue;
        assert.doesNotThrow(
          () => validatePreset(packPreset(doc, encoded), FILTERS),
          type + '.' + field.key,
        );
      }
    }
  const reject = (mutate) => {
    const p = serialize(packPreset(document(), encoded));
    mutate(p);
    assert.throws(() => validatePreset(p, FILTERS), /预设无效/);
  };
  reject((p) => (p.version = 2));
  reject((p) => (p.nodes[0].type = '__proto__'));
  reject(
    (p) => (p.nodes[0].params = JSON.parse('{"__proto__":{"polluted":true}}')),
  );
  reject((p) => (p.nodes[0].params.opacity = 101));
  reject((p) => (p.nodes[0].params.opacity = '50'));
  reject((p) => (p.nodes[0].enabled = 'true'));
  reject(
    (p) => (p.nodes.find((n) => n.type === 'music').params.material = 'webgl'),
  );
  reject(
    (p) => (p.nodes.find((n) => n.type === 'text').params.color = 'url(x)'),
  );
  reject((p) => (p.nodes.find((n) => n.type === 'dither').params.start = 100));
  reject((p) => delete p.assets['asset-1']);
  reject((p) => (p.assets['asset-1'].mime = ['image/png']));
  reject((p) => (p.assets['asset-1'].data = 'not base64!'));
  reject((p) => (p.assets['asset-1'].mime = 'image/svg+xml'));
  reject((p) => (p.output.fit = 'random'));
  reject((p) => (p.output.ratio = '0:0'));
  reject((p) => (p.output.zoom = 0));
  reject((p) => (p.nodes = Array.from({ length: 257 }, () => p.nodes[0])));
  assert.equal({}.polluted, undefined);
});
