import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCanvas, ImageData, loadImage } from '@napi-rs/canvas';
const root = new URL('../', import.meta.url);
function canvasFactory(w, h) {
  const c = createCanvas(w, h);
  c.convertToBlob = async ({ type, quality }) =>
    new Blob(
      [
        type === 'image/jpeg'
          ? c.toBuffer('image/jpeg', Math.round(quality * 100))
          : c.toBuffer('image/png'),
      ],
      { type },
    );
  c.transferToImageBitmap = () => c;
  c.close = () => {};
  return c;
}
const makeBitmap = async (blob) => {
  const image = await loadImage(Buffer.from(await blob.arrayBuffer()));
  image.close = () => {};
  return image;
};
const sandbox = vm.createContext({
  OffscreenCanvas: canvasFactory,
  ImageData,
  Blob,
  createImageBitmap: makeBitmap,
  console,
});
for (const file of ['processor.js', 'liquid-glass.js', 'studio-filters.js'])
  vm.runInContext(
    fs.readFileSync(new URL('public/' + file, root), 'utf8'),
    sandbox,
  );
const Studio = vm.runInContext('Studio', sandbox);
// Load the same catalog used by the UI without adding a runtime dependency to the website.
const { transform } = await import('esbuild');
const transpiled = await transform(
  fs.readFileSync(new URL('lib/editor.ts', root), 'utf8'),
  { loader: 'ts', format: 'cjs' },
);
const catalog = { exports: {} };
vm.runInNewContext(transpiled.code, {
  module: catalog,
  exports: catalog.exports,
  crypto: { getRandomValues: crypto.getRandomValues.bind(crypto) },
});
const { FILTERS } = catalog.exports;
const node = (type, patch = {}) => ({
  id: type,
  type,
  enabled: true,
  params: { ...FILTERS[type].defaults, opacity: 100, ...patch },
});
const base = {
  sourceId: 'gradient',
  canvas: {
    ratio: 'original',
    fit: 'cover',
    background: '#fff',
    offsetX: 50,
    offsetY: 50,
    zoom: 100,
  },
  nodes: [],
};
const gradient = canvasFactory(320, 240),
  ctx = gradient.getContext('2d');
const g = ctx.createLinearGradient(0, 0, 320, 240);
g.addColorStop(0, '#12092e');
g.addColorStop(0.5, '#af7957');
g.addColorStop(1, '#fff');
ctx.fillStyle = g;
ctx.fillRect(0, 0, 320, 240);
ctx.fillStyle = '#eb4155';
ctx.fillRect(70, 40, 70, 140);
const sticker = canvasFactory(80, 60),
  sc = sticker.getContext('2d');
sc.fillStyle = '#10ff80';
sc.fillRect(10, 10, 60, 40);
const assets = new Map([
  ['gradient', gradient],
  ['sticker', sticker],
]);
const bytes = (c) =>
  Buffer.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
const render = async (nodes) =>
  (await Studio.render({ ...base, nodes }, assets, 0)).canvas;
test('native Canvas: all filters, ordered overlays, dimensions, JPEG and PNG', async () => {
  const original = await render([]),
    originalBytes = bytes(original);
  for (const type of Object.keys(FILTERS)) {
    const params =
      type === 'sticker'
        ? { assetId: 'sticker' }
        : type === 'adjust'
          ? { contrast: 130 }
          : {};
    const result = await render([node(type, params)]);
    assert.ok(result.width > 0 && result.height > 0, type + ' has dimensions');
    assert.notDeepEqual(bytes(result), originalBytes, type + ' changes pixels');
    const off = await render([{ ...node(type, params), enabled: false }]);
    assert.deepEqual(bytes(off), originalBytes, type + ' bypass');
    const zero = await render([node(type, { ...params, opacity: 0 })]);
    assert.deepEqual(bytes(zero), originalBytes, type + ' zero strength');
    console.log('PASS', type, result.width + 'x' + result.height);
  }
  const classic = node('music', { material: 'classic' });
  const classicImage = await render([classic]);
  delete classic.params.material;
  assert.deepEqual(
    bytes(classicImage),
    bytes(await render([classic])),
    'older cards retain classic material',
  );
  assert.notDeepEqual(
    bytes(classicImage),
    bytes(await render([node('music')])),
    'liquid material produces a different exported card',
  );
  const text = node('text', { text: 'TEST', size: 20, color: '#ff2020' }),
    threshold = node('threshold');
  assert.notDeepEqual(
    bytes(await render([text, threshold])),
    bytes(await render([threshold, text])),
    'text participates in ordered effects',
  );
  assert.notDeepEqual(
    bytes(await render([node('bloom'), threshold])),
    bytes(await render([threshold, node('bloom')])),
    'filter order changes pixels',
  );
  const portrait = await Studio.render(
    {
      ...base,
      canvas: { ...base.canvas, ratio: '9:16' },
      nodes: [node('sticker', { assetId: 'sticker' }), text],
    },
    assets,
    0,
  );
  assert.equal(portrait.canvas.width, 180);
  assert.equal(portrait.canvas.height, 320);
  const small = await Studio.render(
    {
      ...base,
      canvas: { ...base.canvas, ratio: '9:16' },
      nodes: [node('sticker', { assetId: 'sticker' }), text],
    },
    assets,
    160,
  );
  assert.equal(small.canvas.width, 90);
  assert.equal(small.canvas.height, 160);
  const ink1 = await render([node('print')]),
    ink2 = await render([node('print')]);
  assert.deepEqual(bytes(ink1), bytes(ink2), 'grain is deterministic');
  const combined = await render([
    node('wanted'),
    node('music', { title: 'DARKROOM', artist: 'Image Lab' }),
  ]);
  assert.ok(Math.abs(combined.width / combined.height - 809 / 1771) < 0.01);
  const blob = await combined.convertToBlob({ type: 'image/png' }),
    encoded = await makeBitmap(blob);
  assert.equal(encoded.width, combined.width);
  assert.equal(encoded.height, combined.height);
  const bounded = Studio.canvas(16384, 16384);
  assert.ok(bounded.width * bounded.height <= 32_000_000);
  assert.ok(bounded.width <= 16384);
  const limited = await Studio.render(
    { ...base, nodes: [node('wanted'), node('music')] },
    assets,
    160,
  );
  assert.ok(Math.max(limited.canvas.width, limited.canvas.height) <= 160);
  const native = await Studio.render({ ...base, nodes: [text] }, assets, 0);
  assert.equal(native.canvas.width, 320);
  assert.equal(native.canvas.height, 240);
  assert.notDeepEqual(bytes(native.canvas), bytes(small.canvas));
  const { newId } = catalog.exports;
  assert.equal(new Set(Array.from({ length: 100 }, () => newId())).size, 100);
});

test('final canvas contains or stretches the entire phone composition after all effects', async () => {
  const output = { ...catalog.exports.OUTPUT_DEFAULTS, ratio: '3:2' };
  const doc = { ...base, nodes: [node('music')], output };
  const contained = await Studio.render(doc, assets, 0);
  const stretched = await Studio.render(
    { ...doc, output: { ...output, fit: 'stretch' } },
    assets,
    0,
  );
  for (const result of [contained, stretched]) {
    assert.equal(result.canvas.width, 320);
    assert.equal(result.canvas.height, 213);
    assert.equal(result.reference.width, 320);
    assert.equal(result.reference.height, 213);
  }
  assert.notDeepEqual(bytes(contained.canvas), bytes(stretched.canvas));
  const p = contained.canvas.getContext('2d').getImageData(0, 106, 1, 1).data;
  assert.deepEqual(
    Array.from(p),
    [13, 13, 16, 255],
    'contain keeps letterbox color',
  );
  const phone = await render([node('music')]);
  for (const toggle of ['dynamicIsland', 'desktop', 'airplay', 'speakers']) {
    assert.notDeepEqual(
      bytes(phone),
      bytes(await render([node('music', { [toggle]: false })])),
      toggle + ' affects exported pixels',
    );
  }
  const decode = await makeBitmap(
    await stretched.canvas.convertToBlob({ type: 'image/png' }),
  );
  assert.equal(decode.width, 320);
  assert.equal(decode.height, 213);
  const corners = canvasFactory(4, 2),
    cx = corners.getContext('2d');
  for (const [x, y, color] of [
    [0, 0, '#ff0000'],
    [2, 0, '#00ff00'],
    [0, 1, '#0000ff'],
    [2, 1, '#ffffff'],
  ]) {
    cx.fillStyle = color;
    cx.fillRect(x, y, 2, 1);
  }
  for (const fit of ['contain', 'stretch']) {
    const square = canvasFactory(8, 8),
      sx = square.getContext('2d');
    sx.imageSmoothingEnabled = false;
    Studio.fit(sx, corners, 0, 0, 8, 8, fit);
    const pixel = (x, y) => Array.from(sx.getImageData(x, y, 1, 1).data);
    const top = fit === 'contain' ? 2 : 0,
      bottom = fit === 'contain' ? 5 : 7;
    assert.deepEqual(pixel(0, top), [255, 0, 0, 255]);
    assert.deepEqual(pixel(7, top), [0, 255, 0, 255]);
    assert.deepEqual(pixel(0, bottom), [0, 0, 255, 255]);
    assert.deepEqual(pixel(7, bottom), [255, 255, 255, 255]);
  }
});

test('worker serializes jobs and preserves request identities after an error', async () => {
  const messages = [],
    self = { postMessage: (message) => messages.push(message) };
  const worker = vm.createContext({
    OffscreenCanvas: canvasFactory,
    ImageData,
    Blob,
    createImageBitmap: makeBitmap,
    self,
    console,
  });
  worker.importScripts = (...paths) =>
    paths.forEach((path) =>
      vm.runInContext(
        fs.readFileSync(
          new URL('public/' + path.replace(/^\//, '').split('?')[0], root),
          'utf8',
        ),
        worker,
      ),
    );
  vm.runInContext(
    fs.readFileSync(new URL('public/editor-worker.js', root), 'utf8'),
    worker,
  );
  self.onmessage({
    data: { type: 'asset', assetId: 'gradient', bitmap: gradient },
  });
  self.onmessage({
    data: {
      type: 'preview',
      id: 1,
      revision: 3,
      maxSize: 160,
      document: { ...base, sourceId: 'missing' },
    },
  });
  self.onmessage({
    data: {
      type: 'export',
      id: 2,
      revision: 4,
      maxSize: 0,
      document: { ...base, nodes: [node('quarter')] },
    },
  });
  self.onmessage({
    data: {
      type: 'preview',
      id: 3,
      revision: 5,
      maxSize: 160,
      document: { ...base, nodes: [node('threshold')] },
    },
  });
  await vm.runInContext('studioQueue', worker);
  assert.deepEqual(
    messages.map((message) => message.type),
    ['asset', 'error', 'export', 'preview'],
  );
  assert.deepEqual(
    messages.slice(1).map((message) => message.id),
    [1, 2, 3],
  );
  assert.equal(messages[1].revision, 3);
  assert.equal(messages[3].revision, 5);
  const png = await makeBitmap(messages[2].blob);
  assert.equal(png.width, 320);
  assert.equal(png.height, 240);
  assert.equal(messages[3].width, 160);
  assert.equal(messages[3].reference.width, 160);
});
