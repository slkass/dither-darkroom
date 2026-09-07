/* Original, local Canvas approximations. No third-party LUTs or texture assets. */
const Studio = (() => {
  const cap = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  const col = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const noise = (x, y, seed = 0) => {
    const v = Math.sin(x * 12.9898 + y * 78.233 + seed * 31.7) * 43758.5453;
    return v - Math.floor(v);
  };
  function canvas(w, h) {
    const scale = Math.min(
      1,
      16384 / Math.max(w, h),
      Math.sqrt(32_000_000 / Math.max(1, w * h)),
    );
    return new OffscreenCanvas(
      Math.max(1, Math.floor(w * scale)),
      Math.max(1, Math.floor(h * scale)),
    );
  }
  function context(c) {
    return c.getContext('2d', { willReadFrequently: true });
  }
  function copy(c, w = c.width, h = c.height) {
    const out = canvas(w, h);
    context(out).drawImage(c, 0, 0, out.width, out.height);
    return out;
  }
  function fit(
    ctx,
    image,
    x,
    y,
    w,
    h,
    mode = 'cover',
    px = 50,
    py = 50,
    zoom = 100,
  ) {
    const scale =
      ((mode === 'contain'
        ? Math.min(w / image.width, h / image.height)
        : Math.max(w / image.width, h / image.height)) *
        zoom) /
      100;
    const dw = mode === 'stretch' ? (w * zoom) / 100 : image.width * scale,
      dh = mode === 'stretch' ? (h * zoom) / 100 : image.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.drawImage(
      image,
      x + ((w - dw) * px) / 100,
      y + ((h - dh) * py) / 100,
      dw,
      dh,
    );
    ctx.restore();
  }
  function pixels(c, fn) {
    const out = copy(c),
      ctx = context(out),
      data = ctx.getImageData(0, 0, c.width, c.height);
    fn(data.data, c.width, c.height);
    ctx.putImageData(data, 0, 0);
    return out;
  }
  function blur(c, radius) {
    if (radius < 0.5) return copy(c);
    const out = copy(c),
      ctx = context(out),
      image = ctx.getImageData(0, 0, c.width, c.height),
      a = image.data,
      b = new Uint8ClampedArray(a.length),
      w = c.width,
      h = c.height;
    const r = Math.max(1, Math.round(radius)),
      size = 2 * r + 1;
    // Separable box passes, bounded cost independent of the requested blur radius.
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < h; y++)
        for (let channel = 0; channel < 3; channel++) {
          let sum = 0;
          for (let k = -r; k <= r; k++)
            sum += a[(y * w + cap(k, 0, w - 1)) * 4 + channel];
          for (let x = 0; x < w; x++) {
            b[(y * w + x) * 4 + channel] = sum / size;
            sum +=
              a[(y * w + cap(x + r + 1, 0, w - 1)) * 4 + channel] -
              a[(y * w + cap(x - r, 0, w - 1)) * 4 + channel];
          }
        }
      for (let x = 0; x < w; x++)
        for (let channel = 0; channel < 3; channel++) {
          let sum = 0;
          for (let k = -r; k <= r; k++)
            sum += b[(cap(k, 0, h - 1) * w + x) * 4 + channel];
          for (let y = 0; y < h; y++) {
            a[(y * w + x) * 4 + channel] = sum / size;
            sum +=
              b[(cap(y + r + 1, 0, h - 1) * w + x) * 4 + channel] -
              b[(cap(y - r, 0, h - 1) * w + x) * 4 + channel];
          }
        }
    }
    ctx.putImageData(image, 0, 0);
    return out;
  }
  function detailMap(data, w, h, x, y, channel, radius = 1) {
    return (
      (data[(y * w + Math.max(0, x - radius)) * 4 + channel] +
        data[(y * w + Math.min(w - 1, x + radius)) * 4 + channel] +
        data[(Math.max(0, y - radius) * w + x) * 4 + channel] +
        data[(Math.min(h - 1, y + radius) * w + x) * 4 + channel]) /
      4
    );
  }
  function basic(c, p) {
    return pixels(c, (d, w, h) => {
      const src = new Uint8ClampedArray(d),
        exposure = 2 ** (Number(p.exposure) / 100),
        gamma = 100 / Number(p.gamma),
        radius = Math.max(1, Math.round(Math.max(w, h) / 600));
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4,
            l = lum(src[i], src[i + 1], src[i + 2]);
          for (let k = 0; k < 3; k++) {
            let v = l + ((src[i + k] - l) * Number(p.saturation)) / 100;
            v +=
              (Number(p.sharpness) / 100) *
              (src[i + k] - detailMap(src, w, h, x, y, k, radius));
            v = Math.pow(cap((v * exposure) / 255), gamma) * 255;
            d[i + k] =
              ((v - 127.5) * Number(p.contrast)) / 100 +
              127.5 +
              Number(p.warmth) * [0.3, 0.02, -0.3][k];
          }
        }
    });
  }
  function threshold(c, p) {
    const ink = col(p.ink),
      paper = col(p.paper);
    return pixels(c, (d, w, h) => {
      const src = new Uint8ClampedArray(d),
        radius = Math.max(1, Math.round(Math.max(w, h) / 700));
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          let l = lum(src[i], src[i + 1], src[i + 2]);
          const near = lum(
            ...[0, 1, 2].map((k) => detailMap(src, w, h, x, y, k, radius)),
          );
          l = cap((l + ((l - near) * Number(p.detail)) / 35) / 255);
          let v = l > Number(p.threshold) / 100 ? 1 : 0;
          v = v * (1 - Number(p.gray) / 100) + (l * Number(p.gray)) / 100;
          if (p.invert) v = 1 - v;
          for (let k = 0; k < 3; k++)
            d[i + k] = ink[k] + (paper[k] - ink[k]) * v;
        }
    });
  }
  function bloom(c, p) {
    const scale = Math.min(1, 360 / Math.max(c.width, c.height)),
      small = copy(c, c.width * scale, c.height * scale),
      tint = col(p.tint);
    const mask = pixels(small, (d) => {
      for (let i = 0; i < d.length; i += 4) {
        const l = lum(d[i], d[i + 1], d[i + 2]) / 255,
          t = cap((l - Number(p.threshold) / 100) / 0.18),
          gain = t * t * (3 - 2 * t) * l;
        for (let k = 0; k < 3; k++) d[i + k] = tint[k] * gain;
      }
    });
    const radius = Math.max(
      0.5,
      (Math.min(small.width, small.height) * Number(p.radius)) / 1800,
    );
    const a = blur(mask, radius),
      b = blur(mask, radius * 3),
      out = copy(c),
      ctx = context(out);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = (Number(p.glow) / 100) * 0.75;
    ctx.drawImage(a, 0, 0, out.width, out.height);
    ctx.globalAlpha = (Number(p.glow) / 100) * 0.35;
    ctx.drawImage(b, 0, 0, out.width, out.height);
    return out;
  }
  function bleach(c, p) {
    return pixels(c, (d, w, h) => {
      const scale = 1200 / Math.max(w, h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4,
            l = lum(d[i], d[i + 1], d[i + 2]) / 255,
            grain =
              (noise(Math.floor(x * scale), Math.floor(y * scale)) - 0.5) *
              Number(p.grain) *
              0.7;
          for (let k = 0; k < 3; k++) {
            const v = l + ((d[i + k] / 255 - l) * Number(p.saturation)) / 100,
              silver = v < 0.5 ? 2 * v * l : 1 - 2 * (1 - v) * (1 - l);
            d[i + k] =
              (v + ((silver - v) * Number(p.silver)) / 100) * 255 + grain;
          }
        }
    });
  }
  function bilateral(c, strength) {
    if (!strength) return c;
    return pixels(c, (d, w, h) => {
      const src = new Uint8ClampedArray(d);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4,
            l = lum(src[i], src[i + 1], src[i + 2]),
            sums = [0, 0, 0];
          let total = 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const j = (cap(y + dy, 0, h - 1) * w + cap(x + dx, 0, w - 1)) * 4,
                delta = lum(src[j], src[j + 1], src[j + 2]) - l,
                weight = Math.exp(
                  -(dx * dx + dy * dy) / 3 - (delta * delta) / 900,
                );
              total += weight;
              for (let k = 0; k < 3; k++) sums[k] += src[j + k] * weight;
            }
          for (let k = 0; k < 3; k++)
            d[i + k] = src[i + k] + (sums[k] / total - src[i + k]) * strength;
        }
    });
  }
  async function camera(c, p, quarter) {
    const scale = Math.min(
      1,
      Number(p.resolution) / Math.max(c.width, c.height),
    );
    let small = copy(c, c.width * scale, c.height * scale);
    if (!quarter) small = blur(small, 0.7);
    small = pixels(small, (d, w, h) => {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4,
            l = lum(d[i], d[i + 1], d[i + 2]) / 255;
          for (let k = 0; k < 3; k++) {
            const cast = quarter
              ? [-7, 0, 10][k]
              : (1 - l) * [-4, 1, 10][k] + l * [10, 1, -4][k];
            const n =
              (noise(x, y, quarter ? k + 1 : 4) - 0.5) *
              Number(quarter ? p.noise : p.grain) *
              0.85;
            d[i + k] = (d[i + k] - 127) * 1.08 + 127 + cast + n;
          }
        }
    });
    small = bloom(small, {
      threshold: 65,
      radius: 22,
      glow: p.glow,
      tint: quarter ? '#83a4ff' : '#e392fc',
    });
    if (!quarter && Number(p.flare)) {
      const ctx = context(small),
        w = small.width,
        h = small.height;
      ctx.globalCompositeOperation = 'screen';
      const gradient = ctx.createRadialGradient(
        w * 0.77,
        h * 0.17,
        0,
        w * 0.77,
        h * 0.17,
        w * 0.36,
      );
      gradient.addColorStop(0, `rgba(255,177,230,${Number(p.flare) / 170})`);
      gradient.addColorStop(1, 'rgba(130,100,220,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }
    // Real JPEG encode/decode produces resolution and compression texture, not a decorative overlay.
    const blob = await small.convertToBlob({
        type: 'image/jpeg',
        quality: Number(p.quality) / 100,
      }),
      bitmap = await createImageBitmap(blob);
    small = copy(bitmap);
    bitmap.close();
    small = quarter
      ? bilateral(small, Number(p.smoothing) / 100)
      : basic(small, {
          exposure: 0,
          contrast: 100,
          saturation: 100,
          warmth: 0,
          gamma: 100,
          sharpness: 35,
        });
    return copy(small, c.width, c.height);
  }
  function print(c, p) {
    return pixels(c, (d, w, h) => {
      const scale = 1200 / Math.max(w, h),
        paper = [
          245,
          243 - Number(p.yellow) * 0.12,
          237 - Number(p.yellow) * 0.3,
        ];
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4,
            nx = Math.floor(x * scale),
            ny = Math.floor(y * scale),
            fine = noise(nx, ny, 9),
            coarse = noise(Math.floor(nx / 24), Math.floor(ny / 24), 3),
            l = lum(d[i], d[i + 1], d[i + 2]);
          const v = cap((l - 128) * (1 + Number(p.ink) / 60) + 128, 0, 255),
            wear = Number(p.wear) / 100,
            erased = fine > 1 - wear * 0.08 && v < 180;
          const red = p.preserveRed && d[i] > d[i + 1] * 1.5 && d[i] > 70;
          const fiber =
            (fine - 0.5) * Number(p.grain) * 0.65 +
            (coarse - 0.5) * wear * 18 +
            Math.sin(nx * 0.021 + Math.sin(ny * 0.006) * 6) ** 30 * wear * 14;
          for (let k = 0; k < 3; k++) {
            const value = erased
              ? paper[k]
              : red
                ? d[i + k]
                : v * 0.83 + d[i + k] * 0.17;
            d[i + k] = (value * paper[k]) / 255 + fiber;
          }
        }
    });
  }
  function rounded(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  }
  function overlay(c, p, type, assets) {
    const out = copy(c),
      ctx = context(out),
      x = (Number(p.x) / 100) * c.width,
      y = (Number(p.y) / 100) * c.height,
      width = (Number(p.width) / 100) * c.width;
    ctx.translate(x, y);
    ctx.rotate((Number(p.rotation) * Math.PI) / 180);
    ctx.globalAlpha = Number(p.opacity) / 100;
    if (type === 'sticker') {
      const image = assets.get(p.assetId);
      if (!image) throw new Error('贴图资源未载入');
      const height = (width * image.height) / image.width;
      ctx.drawImage(image, -width / 2, -height / 2, width, height);
    } else {
      const size = (Number(p.size) / 100) * Math.min(c.width, c.height),
        lines = String(p.text).split('\n');
      ctx.font = `${p.bold ? '700' : '400'} ${size}px ${p.font}`;
      ctx.textAlign = p.align;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.outline;
      ctx.lineWidth = (size * Number(p.stroke)) / 100;
      ctx.lineJoin = 'round';
      const tx =
        p.align === 'left' ? -width / 2 : p.align === 'right' ? width / 2 : 0;
      lines.forEach((line, index) => {
        const ty = (index - (lines.length - 1) / 2) * size * 1.2;
        if (Number(p.stroke)) ctx.strokeText(line, tx, ty, width);
        ctx.fillText(line, tx, ty, width);
      });
    }
    return out;
  }
  function wanted(c, p, assets) {
    const edge = Math.max(c.width, c.height),
      out = canvas(edge / 1.05, edge),
      ctx = context(out),
      w = out.width,
      h = out.height,
      margin = w * 0.035;
    ctx.fillStyle = '#eeeae1';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = p.titleColor;
    ctx.font = `900 ${h * 0.105}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.title, w / 2, h * 0.083, w - 2 * margin);
    const top = h * 0.16,
      ph = h * 0.67,
      image = assets.get(p.assetId) ?? c,
      double = p.layout === 'double',
      pw = double ? (w - 3 * margin) / 2 : w - 2 * margin;
    if (double)
      fit(
        ctx,
        image,
        margin,
        top,
        pw,
        ph,
        'cover',
        Number(p.photoX),
        Number(p.photoY),
        Number(p.photoZoom),
      );
    const portrait = threshold(c, {
      threshold: 48,
      detail: 35,
      gray: 100 - Number(p.ink),
      invert: false,
      ink: '#080808',
      paper: '#f6f4ed',
    });
    fit(ctx, portrait, double ? 2 * margin + pw : margin, top, pw, ph);
    ctx.fillStyle = '#171411';
    ctx.font = `900 ${w * 0.031}px serif`;
    ctx.textAlign = 'center';
    ctx.fillText(
      double ? p.caption : p.title,
      double ? margin + pw / 2 : w / 2,
      h * 0.875,
      pw,
    );
    ctx.fillText(
      p.footer,
      double ? 2 * margin + pw * 0.5 + pw : w / 2,
      h * (double ? 0.875 : 0.93),
      pw,
    );
    if (p.stamp) {
      ctx.save();
      ctx.translate(w * 0.86, h * 0.88);
      ctx.rotate(-0.24);
      ctx.strokeStyle = '#3c3934';
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = w * 0.002;
      for (const r of [0.082, 0.073]) {
        ctx.beginPath();
        ctx.arc(0, 0, w * r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.font = `700 ${w * 0.019}px serif`;
      ctx.fillText('ARCHIVE', 0, -w * 0.018, w * 0.13);
      ctx.fillText('NO. 001', 0, w * 0.018, w * 0.11);
      ctx.restore();
    }
    return print(out, {
      ink: 22,
      wear: p.wear,
      yellow: 10,
      grain: 32,
      preserveRed: true,
    });
  }
  function music(c, p) {
    // One design coordinate system keeps every phone element proportional at export size.
    const edge = Math.max(c.width, c.height),
      out = canvas((edge * 809) / 1771, edge),
      ctx = context(out);
    const w = out.width,
      h = out.height,
      s = w / 809,
      liquid = p.material === 'liquid';
    const desktop = canvas(360, 788),
      dc = context(desktop),
      ds = 360 / 809;
    fit(dc, c, 0, 0, desktop.width, desktop.height);
    dc.fillStyle = 'rgba(5,7,10,.76)';
    dc.fillRect(0, 0, desktop.width, desktop.height);
    if (p.desktop !== false) {
      dc.save();
      dc.scale(ds, ds);
      const colors = [
        '#a83966',
        '#9a7518',
        '#427b98',
        '#624c8f',
        '#216b63',
        '#a45d34',
        '#537846',
        '#436498',
      ];
      for (let row = 0; row < 8; row++)
        for (let column = 0; column < 4; column++) {
          const x = 80 + column * 180,
            y = 195 + row * 190;
          rounded(dc, x, y, 110, 110, 26);
          dc.fillStyle = colors[(row * 3 + column) % colors.length];
          dc.fill();
          dc.strokeStyle = '#ffffff65';
          dc.lineWidth = 9;
          if ((row + column) % 2) {
            rounded(dc, x + 28, y + 28, 54, 54, 14);
            dc.stroke();
          } else {
            dc.beginPath();
            dc.arc(x + 55, y + 55, 26, 0, Math.PI * 2);
            dc.stroke();
          }
        }
      dc.restore();
    }
    const soft = blur(
      desktop,
      Number(p.desktop !== false ? (p.desktopBlur ?? 55) : p.blur) * 0.18,
    );
    const bc = context(soft);
    bc.fillStyle = 'rgba(0,0,0,.58)';
    bc.fillRect(0, 0, soft.width, soft.height);
    ctx.drawImage(soft, 0, 0, w, h);
    const frosted = blur(soft, Number(p.blur) * 0.045),
      fc = context(frosted);
    fc.fillStyle = `rgba(210,213,218,${0.12 + Number(p.glass) * 0.0024})`;
    fc.fillRect(0, 0, frosted.width, frosted.height);
    const cs = (w * Number(p.size)) / 100 / 664,
      cx = (w - 664 * cs) / 2;
    const cy = Math.min(303 * s, h - (1185 + 32 + 91) * cs - 40 * s),
      radius = (664 * cs * Number(p.roundness)) / 100;
    function glass(x, y, width, height, r) {
      ctx.save();
      ctx.shadowColor = '#00000045';
      ctx.shadowBlur = 26 * s;
      ctx.shadowOffsetY = 8 * s;
      rounded(ctx, x, y, width, height, r);
      ctx.fillStyle = '#77777735';
      ctx.fill();
      ctx.restore();
      if (liquid)
        LiquidGlass.paint(
          ctx,
          frosted,
          { x, y, width, height, radius: r },
          {
            refraction: Number(p.refraction ?? 55),
            thickness: Number(p.thickness ?? 35),
            dispersion: Number(p.dispersion ?? 25),
            highlight: Number(p.highlight ?? 65),
            light: Number(p.light ?? -135),
            tint: Number(p.glass) * 0.25,
          },
        );
      else {
        ctx.save();
        rounded(ctx, x, y, width, height, r);
        ctx.clip();
        ctx.drawImage(frosted, 0, 0, w, h);
        ctx.restore();
      }
      rounded(ctx, x, y, width, height, r);
      const rim = ctx.createLinearGradient(x, y, x + width, y + height);
      rim.addColorStop(0, '#ffffff80');
      rim.addColorStop(0.5, '#ffffff0b');
      rim.addColorStop(1, '#ffffff70');
      ctx.strokeStyle = rim;
      ctx.lineWidth = 1.8 * s;
      ctx.stroke();
    }
    const toneSample = fc.getImageData(
      0,
      Math.floor(frosted.height * 0.55),
      frosted.width,
      Math.max(1, Math.floor(frosted.height * 0.3)),
    ).data;
    let mean = 0;
    for (let i = 0; i < toneSample.length; i += 4)
      mean += lum(toneSample[i], toneSample[i + 1], toneSample[i + 2]);
    const darkText =
      p.textTone === 'dark' ||
      (p.textTone !== 'light' && mean / (toneSample.length / 4) > 155);
    const foreground = darkText ? '#202127' : '#fafafa',
      secondary = darkText ? '#4c4e58' : '#c5c5c8';
    function eq(x, y, scale, color) {
      ctx.fillStyle = color;
      [4, 13, 25, 34, 31, 28].forEach((height, i) => {
        rounded(
          ctx,
          x + i * 7 * scale,
          y + ((34 - height) * scale) / 2,
          4 * scale,
          height * scale,
          2 * scale,
        );
        ctx.fill();
      });
    }
    if (p.dynamicIsland !== false) {
      rounded(ctx, 208 * s, 31 * s, 391 * s, 82 * s, 41 * s);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.strokeStyle = '#323232';
      ctx.lineWidth = 3 * s;
      ctx.stroke();
      ctx.save();
      rounded(ctx, 229 * s, 49 * s, 46 * s, 46 * s, 12 * s);
      ctx.clip();
      fit(ctx, c, 229 * s, 49 * s, 46 * s, 46 * s);
      ctx.restore();
      eq(535 * s, 55 * s, s, '#7c7c84');
    }
    glass(cx, cy, 664 * cs, 1185 * cs, radius);
    if (p.speakers !== false)
      glass(w / 2 - 185 * cs, cy + 1217 * cs, 370 * cs, 91 * cs, 45.5 * cs);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(cs, cs);
    ctx.save();
    rounded(ctx, 49, 49, 566, 566, 21);
    ctx.clip();
    fit(ctx, c, 49, 49, 566, 566);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    function label(text, x, y, maxWidth, font, color) {
      ctx.font = font;
      ctx.fillStyle = color;
      let result = String(text),
        shortened = false;
      while (
        result.length &&
        ctx.measureText(result + (shortened ? '…' : '')).width > maxWidth
      ) {
        result = result.slice(0, -1);
        shortened = true;
      }
      ctx.fillText(result + (shortened ? '…' : ''), x, y);
    }
    label(
      p.title,
      49,
      691,
      p.explicit ? 420 : 470,
      '600 31px Arial, sans-serif',
      foreground,
    );
    label(p.artist, 49, 730, 470, '30px Arial, sans-serif', secondary);
    if (p.explicit) {
      rounded(ctx, 490, 668, 22, 24, 4);
      ctx.fillStyle = foreground;
      ctx.fill();
      ctx.font = '700 17px Arial, sans-serif';
      ctx.fillStyle = '#555';
      ctx.fillText('E', 495, 686);
    }
    eq(553, 682, 1, foreground);
    const progress = cap(Number(p.progress) / 100),
      duration = Number(p.duration);
    function bar(x, y, width, value) {
      rounded(ctx, x, y, width, 15, 7.5);
      ctx.fillStyle = '#ffffff65';
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.fillStyle = foreground;
      ctx.fillRect(x, y, width * value, 15);
      ctx.restore();
    }
    bar(49, 775, 566, progress);
    const time = (seconds) =>
      `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
    ctx.font = '24px Arial, sans-serif';
    ctx.fillStyle = secondary;
    ctx.fillText(time(duration * progress), 49, 829);
    ctx.textAlign = 'right';
    ctx.fillText('−' + time(duration * (1 - progress)), 615, 829);
    ctx.textAlign = 'left';
    ctx.fillStyle = foreground;
    for (const x of [305, 338]) {
      rounded(ctx, x, 869, 21, 70, 5);
      ctx.fill();
    }
    function triangle(x, direction) {
      ctx.beginPath();
      ctx.moveTo(x - direction * 18, 881);
      ctx.lineTo(x + direction * 18, 903);
      ctx.lineTo(x - direction * 18, 925);
      ctx.closePath();
      ctx.fill();
    }
    for (const x of [179, 215]) triangle(x, -1);
    for (const x of [448, 484]) triangle(x, 1);
    bar(100, 1015, 446, cap(Number(p.volume ?? 30) / 100));
    function speaker(x, waves) {
      ctx.fillStyle = secondary;
      ctx.beginPath();
      ctx.moveTo(x, 1018);
      ctx.lineTo(x + 7, 1018);
      ctx.lineTo(x + 17, 1010);
      ctx.lineTo(x + 17, 1035);
      ctx.lineTo(x + 7, 1027);
      ctx.lineTo(x, 1027);
      ctx.closePath();
      ctx.fill();
      if (waves) {
        ctx.strokeStyle = secondary;
        ctx.lineWidth = 2.6;
        for (const r of [12, 19, 26]) {
          ctx.beginPath();
          ctx.arc(x + 16, 1022, r, -0.65, 0.65);
          ctx.stroke();
        }
      }
    }
    speaker(53, false);
    speaker(573, true);
    if (p.airplay !== false) {
      rounded(ctx, 244, 1069, 175, 67, 33.5);
      ctx.fillStyle = '#ffffff19';
      ctx.fill();
      ctx.strokeStyle = foreground;
      ctx.lineWidth = 1.8;
      for (const r of [5, 9, 13]) {
        ctx.beginPath();
        ctx.arc(282, 1101, r, Math.PI * 0.75, Math.PI * 2.25);
        ctx.stroke();
      }
      ctx.fillStyle = foreground;
      ctx.beginPath();
      ctx.moveTo(282, 1101);
      ctx.lineTo(274, 1115);
      ctx.lineTo(290, 1115);
      ctx.closePath();
      ctx.fill();
      ctx.font = '27px Arial, sans-serif';
      ctx.fillText('AirPlay', 308, 1112);
    }
    if (p.speakers !== false) {
      ctx.strokeStyle = secondary;
      ctx.lineWidth = 3;
      rounded(ctx, 193, 1248, 36, 24, 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(201, 1278);
      ctx.lineTo(216, 1278);
      ctx.stroke();
      rounded(ctx, 219, 1260, 14, 21, 2);
      ctx.fillStyle = foreground;
      ctx.fill();
      ctx.fillStyle = '#666';
      for (const y of [1266, 1275]) {
        ctx.beginPath();
        ctx.arc(226, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      label(
        'All Speakers & TVs',
        249,
        1272,
        240,
        '600 25px Arial, sans-serif',
        foreground,
      );
    }
    ctx.restore();
    return out;
  }

  function dimensions(source, settings, maxSize = 0) {
    let ratio = source.width / source.height;
    if (settings.ratio !== 'original') {
      const [a, b] = settings.ratio.split(':').map(Number);
      if (a > 0 && b > 0 && a / b >= 0.1 && a / b <= 10) ratio = a / b;
    }
    const edge = Math.min(
      maxSize || Infinity,
      Math.max(source.width, source.height),
      16384,
    );
    let w = ratio >= 1 ? edge : edge * ratio,
      h = ratio >= 1 ? edge / ratio : edge;
    const scale = Math.min(1, Math.sqrt(32_000_000 / (w * h)));
    return [
      Math.max(1, Math.round(w * scale)),
      Math.max(1, Math.round(h * scale)),
    ];
  }
  function base(source, settings, maxSize) {
    const [w, h] = dimensions(source, settings, maxSize),
      out = canvas(w, h),
      ctx = context(out);
    ctx.fillStyle = settings.background;
    ctx.fillRect(0, 0, w, h);
    fit(
      ctx,
      source,
      0,
      0,
      w,
      h,
      settings.fit,
      settings.offsetX,
      settings.offsetY,
      settings.zoom,
    );
    return out;
  }
  async function render(document, assets, maxSize) {
    const source = assets.get(document.sourceId);
    if (!source) throw new Error('原图尚未载入');
    let current = base(source, document.canvas, maxSize),
      reference = copy(current);
    for (const node of document.nodes) {
      if (!node.enabled || Number(node.params.opacity) === 0) continue;
      const p = node.params,
        before = current;
      let result;
      if (node.type === 'dither') {
        const ctx = context(current),
          input = ctx.getImageData(0, 0, current.width, current.height);
        result = processImage(
          { width: current.width, height: current.height, pixels: input },
          p,
        );
        if (Number(p.sourceColor))
          result = pixels(result, (d) => {
            for (let i = 0; i < d.length; i += 4) {
              const originalL = Math.max(
                  1,
                  lum(input.data[i], input.data[i + 1], input.data[i + 2]),
                ),
                outL = lum(d[i], d[i + 1], d[i + 2]);
              for (let k = 0; k < 3; k++)
                d[i + k] +=
                  (((input.data[i + k] * outL) / originalL - d[i + k]) *
                    Number(p.sourceColor)) /
                  100;
            }
          });
      } else if (node.type === 'adjust') result = basic(current, p);
      else if (node.type === 'threshold') result = threshold(current, p);
      else if (node.type === 'bloom') result = bloom(current, p);
      else if (node.type === 'bleach') result = bleach(current, p);
      else if (node.type === 'quarter' || node.type === 'ccd')
        result = await camera(current, p, node.type === 'quarter');
      else if (node.type === 'print') result = print(current, p);
      else if (node.type === 'text' || node.type === 'sticker') {
        current = overlay(current, p, node.type, assets);
        continue;
      } else if (node.type === 'wanted') result = wanted(current, p, assets);
      else if (node.type === 'music') result = music(current, p);
      else continue;
      if (Number(p.opacity) < 100) {
        current = copy(before, result.width, result.height);
        const ctx = context(current);
        ctx.globalAlpha = Number(p.opacity) / 100;
        ctx.drawImage(result, 0, 0);
      } else current = result;
    }
    if (
      reference.width !== current.width ||
      reference.height !== current.height
    ) {
      reference = canvas(current.width, current.height);
      const ctx = context(reference);
      ctx.fillStyle = document.canvas.background;
      ctx.fillRect(0, 0, reference.width, reference.height);
      fit(ctx, source, 0, 0, reference.width, reference.height, 'contain');
    }
    if (
      document.output &&
      (document.output.ratio !== 'original' ||
        Number(document.output.zoom) !== 100)
    ) {
      current = base(current, document.output, maxSize);
      reference = base(reference, document.output, maxSize);
    }
    return { canvas: current, reference };
  }
  return {
    canvas,
    context,
    copy,
    fit,
    pixels,
    blur,
    basic,
    threshold,
    bloom,
    bleach,
    print,
    dimensions,
    render,
    noise,
  };
})();
