import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { createCanvas, ImageData } from '@napi-rs/canvas';
function Canvas(w, h) {
  return createCanvas(w, h);
}
const context = vm.createContext({ OffscreenCanvas: Canvas, ImageData });
vm.runInContext(
  fs.readFileSync(
    new URL('../public/liquid-glass.js', import.meta.url),
    'utf8',
  ),
  context,
);
const glass = vm.runInContext('LiquidGlass', context);
function fixture(width = 160, height = 240) {
  const image = createCanvas(width, height),
    ctx = image.getContext('2d'),
    data = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        value = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 220 : 40;
      data.data[i] = data.data[i + 1] = data.data[i + 2] = value;
      data.data[i + 3] = 255;
    }
  ctx.putImageData(data, 0, 0);
  return image;
}
const image = fixture(),
  rect = { x: 24, y: 25, width: 112, height: 186, radius: 16 };
const options = {
  refraction: 70,
  thickness: 70,
  dispersion: 0,
  tint: 0,
  highlight: 0,
  light: -135,
};
function render(patch = {}, targetRect = rect, scale = 1, source = image) {
  const out = createCanvas(160 * scale, 240 * scale),
    ctx = out.getContext('2d');
  ctx.drawImage(source, 0, 0, out.width, out.height);
  const r = Object.fromEntries(
    Object.entries(targetRect).map(([k, v]) => [k, v * scale]),
  );
  glass.paint(ctx, source, r, { ...options, ...patch });
  return out;
}
const pixel = (canvas, x, y) =>
  Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data);
const bytes = (canvas) =>
  Buffer.from(
    canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height)
      .data,
  );
test('lens normals and masks handle round corners, flat sides and square corners', () => {
  const center = glass.profile(50, 75, 100, 150, 15, 10);
  assert.equal(center.amount, 0);
  const edge = glass.profile(50, 1, 100, 150, 15, 10);
  assert.equal(edge.nx, 0);
  assert.equal(edge.ny, -1);
  assert.ok(edge.amount > 0.7);
  assert.ok(glass.profile(0, 0, 100, 150, 15, 10).distance > 0);
  const square = glass.profile(99, 75, 100, 150, 0, 10);
  assert.equal(square.nx, 1);
  assert.equal(square.ny, 0);
});
test('refraction changes the actual backdrop only near the lens boundary', () => {
  const out = render(),
    plain = render({ refraction: 0 });
  assert.deepEqual(pixel(out, 80, 115), pixel(image, 80, 115));
  assert.deepEqual(pixel(out, 0, 0), pixel(image, 0, 0));
  assert.deepEqual(pixel(out, 24, 25), pixel(image, 24, 25));
  assert.notDeepEqual(bytes(out), bytes(plain));
  assert.deepEqual(pixel(plain, 80, 30), pixel(image, 80, 30));
});
test('dispersion splits grayscale into colored edges and light direction changes glint', () => {
  const mono = render(),
    color = render({ dispersion: 100 }),
    a = color.getContext('2d').getImageData(0, 0, 160, 240).data;
  let split = 0;
  for (let i = 0; i < a.length; i += 4)
    if (Math.abs(a[i] - a[i + 2]) > 8) split++;
  assert.ok(split > 20);
  assert.notDeepEqual(bytes(mono), bytes(color));
  assert.notDeepEqual(
    bytes(render({ highlight: 90, light: -135 })),
    bytes(render({ highlight: 90, light: 45 })),
  );
});
test('native-size lens matches preview geometry and clamps extreme edge samples', () => {
  const smooth = createCanvas(160, 240),
    smoothCtx = smooth.getContext('2d');
  const gradient = smoothCtx.createLinearGradient(0, 0, 160, 240);
  gradient.addColorStop(0, '#121530');
  gradient.addColorStop(1, '#f9e6d4');
  smoothCtx.fillStyle = gradient;
  smoothCtx.fillRect(0, 0, 160, 240);
  const small = render({ dispersion: 60 }, rect, 1, smooth),
    large = render({ dispersion: 60 }, rect, 2, smooth);
  // Compare the same physical pixel centres by averaging the two high-resolution samples.
  let difference = 0,
    count = 0;
  for (let y = 28; y < 205; y += 7)
    for (let x = 30; x < 130; x += 7) {
      const a = pixel(small, x, y),
        b = large.getContext('2d').getImageData(x * 2, y * 2, 2, 2).data;
      for (let k = 0; k < 3; k++) {
        difference += Math.abs(
          a[k] - (b[k] + b[k + 4] + b[k + 8] + b[k + 12]) / 4,
        );
        count++;
      }
    }
  assert.ok(difference / count < 3, String(difference / count));
  const edge = render(
    { refraction: 100, dispersion: 100, thickness: 100 },
    { x: 0, y: 0, width: 160, height: 240, radius: 0 },
  );
  assert.equal(pixel(edge, 0, 0)[3], 255);
  assert.equal(pixel(edge, 159, 239)[3], 255);
});
