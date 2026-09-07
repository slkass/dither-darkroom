/*
 * Canvas CPU adaptation of liquid-glass-canvas's MIT-declared fragment shader.
 * Upstream: Whynotmetoo/liquid-glass-canvas, commit
 * b14d0b21b67102b5e70ab264d38535ab0f3d44fb, src/shaders/liquidGlass.frag.ts.
 * Attribution and license: /licenses/liquid-glass-canvas.txt
 * Adaptations: top-left pixels, analytic flat-edge normals, bilinear sampling,
 * image-relative chromatic dispersion, anti-aliasing, adjustable light direction.
 * The same rasterizer is used for previews and PNG export; no DOM or GPU required.
 */
const LiquidGlass = (() => {
  const clamp = (v, low = 0, high = 1) => Math.max(low, Math.min(high, v));
  function profile(x, y, width, height, radius, feather) {
    const px = x - width / 2,
      py = y - height / 2;
    const r = clamp(radius, 0, Math.min(width, height) / 2);
    const dx = Math.abs(px) - width / 2 + r,
      dy = Math.abs(py) - height / 2 + r;
    const qx = Math.max(dx, 0),
      qy = Math.max(dy, 0),
      length = Math.hypot(qx, qy);
    const distance = Math.min(Math.max(dx, dy), 0) + length - r;
    const edge = clamp((distance + feather) / Math.max(0.001, feather));
    const normalX =
      length > 0.0001
        ? (Math.sign(px) * qx) / length
        : dx >= dy
          ? Math.sign(px)
          : 0;
    const normalY =
      length > 0.0001
        ? (Math.sign(py) * qy) / length
        : dy > dx
          ? Math.sign(py)
          : 0;
    return { distance, amount: edge * edge, nx: normalX, ny: normalY };
  }
  function sample(data, width, height, x, y, channel) {
    x = clamp(x, 0, width - 1);
    y = clamp(y, 0, height - 1);
    const x0 = Math.floor(x),
      y0 = Math.floor(y),
      x1 = Math.min(x0 + 1, width - 1),
      y1 = Math.min(y0 + 1, height - 1),
      fx = x - x0,
      fy = y - y0;
    const top =
      data[(y0 * width + x0) * 4 + channel] * (1 - fx) +
      data[(y0 * width + x1) * 4 + channel] * fx;
    const bottom =
      data[(y1 * width + x0) * 4 + channel] * (1 - fx) +
      data[(y1 * width + x1) * 4 + channel] * fx;
    return top * (1 - fy) + bottom * fy;
  }
  function paint(ctx, backdrop, rect, options) {
    const sw = backdrop.width,
      sh = backdrop.height,
      source = backdrop.getContext('2d').getImageData(0, 0, sw, sh).data;
    const left = Math.floor(rect.x),
      top = Math.floor(rect.y),
      width = Math.ceil(rect.width + rect.x - left),
      height = Math.ceil(rect.height + rect.y - top);
    // Reuse a narrow strip rather than allocating another full native-size card.
    const stripHeight = Math.min(128, height);
    const layer = new OffscreenCanvas(width, stripHeight),
      layerCtx = layer.getContext('2d'),
      result = new ImageData(width, stripHeight),
      out = result.data;
    const scaleX = sw / ctx.canvas.width,
      scaleY = sh / ctx.canvas.height;
    const feather =
        rect.width * (0.012 + clamp(options.thickness / 100) * 0.09),
      depth = rect.width * 0.075 * clamp(options.refraction / 100);
    const dispersion = clamp(options.dispersion / 100) * 0.24,
      tint = clamp(options.tint / 100) * 0.55,
      glint = clamp(options.highlight / 100);
    const angle = (options.light * Math.PI) / 180,
      lx = Math.cos(angle),
      ly = Math.sin(angle);
    for (let startY = 0; startY < height; startY += stripHeight) {
      const rows = Math.min(stripHeight, height - startY);
      out.fill(0);
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < width; x++) {
          const gx = left + x + 0.5,
            gy = top + startY + y + 0.5,
            lens = profile(
              gx - rect.x,
              gy - rect.y,
              rect.width,
              rect.height,
              rect.radius,
              feather,
            );
          const coverage = clamp(0.5 - lens.distance);
          if (!coverage) continue;
          const amount = lens.amount,
            displacement = amount * depth;
          const specular =
            Math.max(lens.nx * lx + lens.ny * ly, 0) ** 4 * amount;
          const rim = amount ** 3 * 0.11,
            highlight = (specular * 0.65 + rim) * glint;
          const index = (y * width + x) * 4;
          for (let channel = 0; channel < 3; channel++) {
            const offset = displacement * (1 + (1 - channel) * dispersion);
            const sx = (gx - lens.nx * offset) * scaleX - 0.5,
              sy = (gy - lens.ny * offset) * scaleY - 0.5;
            const value = sample(source, sw, sh, sx, sy, channel);
            const colored = value * (1 - tint) + [27, 29, 37][channel] * tint;
            out[index + channel] = colored + (255 - colored) * clamp(highlight);
          }
          out[index + 3] = coverage * 255;
        }
      layerCtx.putImageData(result, 0, 0);
      ctx.drawImage(layer, 0, 0, width, rows, left, top + startY, width, rows);
    }
  }
  return { paint, profile, sample };
})();
