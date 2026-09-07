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
    const dw = image.width * scale,
      dh = image.height * scale;
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
    const edge = Math.max(c.width, c.height),
      out = canvas((edge * 9) / 16, edge),
      ctx = context(out),
      w = out.width,
      h = out.height;
    const liquid = p.material === 'liquid';
    const sharpBackground = liquid && Number(p.blur) === 0;
    const bg = canvas(
      sharpBackground ? w : liquid ? 360 : 180,
      sharpBackground ? h : liquid ? 640 : 320,
    );
    fit(context(bg), c, 0, 0, bg.width, bg.height);
    const soft = blur(bg, Number(p.blur) / (liquid ? 8 : 3));
    const backdrop = context(soft);
    backdrop.fillStyle = liquid
      ? 'rgba(237,237,243,.26)'
      : 'rgba(237,237,237,.67)';
    backdrop.fillRect(0, 0, soft.width, soft.height);
    ctx.drawImage(soft, 0, 0, w, h);
    const cw = (w * Number(p.size)) / 100,
      ch = cw * 1.62,
      cx = (w - cw) / 2,
      cy = (h - ch) / 2,
      padding = cw * 0.07,
      cover = cw - padding * 2,
      left = cx + padding;
    const radius = (cw * Number(p.roundness)) / 100;
    if (liquid) {
      ctx.save();
      ctx.shadowColor = 'rgba(15,13,24,.28)';
      ctx.shadowBlur = cw * 0.055;
      ctx.shadowOffsetY = cw * 0.018;
      rounded(ctx, cx, cy, cw, ch, radius);
      ctx.fillStyle = 'rgba(20,20,30,.18)';
      ctx.fill();
      ctx.restore();
      LiquidGlass.paint(
        ctx,
        soft,
        { x: cx, y: cy, width: cw, height: ch, radius },
        {
          refraction: Number(p.refraction ?? 55),
          thickness: Number(p.thickness ?? 35),
          dispersion: Number(p.dispersion ?? 25),
          highlight: Number(p.highlight ?? 65),
          light: Number(p.light ?? -135),
          tint: Number(p.glass),
        },
      );
      // A thin reflective rim stays sharp at native export resolution.
      ctx.save();
      rounded(ctx, cx, cy, cw, ch, radius);
      ctx.clip();
      const angle = (Number(p.light ?? -135) * Math.PI) / 180;
      const rim = ctx.createLinearGradient(
        w / 2 + Math.cos(angle) * cw,
        h / 2 + Math.sin(angle) * ch,
        w / 2 - Math.cos(angle) * cw,
        h / 2 - Math.sin(angle) * ch,
      );
      const highlight = Number(p.highlight ?? 65) / 100;
      rim.addColorStop(0, `rgba(255,255,255,${0.85 * highlight})`);
      rim.addColorStop(0.48, `rgba(255,255,255,${0.06 * highlight})`);
      rim.addColorStop(1, `rgba(240,245,255,${0.5 * highlight})`);
      ctx.strokeStyle = rim;
      ctx.lineWidth = Math.max(0.7, cw * 0.004);
      ctx.stroke();
      ctx.restore();
    } else {
      rounded(ctx, cx, cy, cw, ch, radius);
      ctx.fillStyle = `rgba(35,35,37,${Number(p.glass) / 100})`;
      ctx.fill();
    }
    const region = backdrop.getImageData(
      Math.floor(soft.width * 0.18),
      Math.floor(soft.height * 0.56),
      Math.max(1, Math.floor(soft.width * 0.64)),
      Math.max(1, Math.floor(soft.height * 0.22)),
    ).data;
    let average = 0;
    for (let i = 0; i < region.length; i += 4)
      average += lum(region[i], region[i + 1], region[i + 2]);
    average /= region.length / 4;
    const tint = (Number(p.glass) / 100) * 0.55;
    const darkText =
      p.textTone === 'dark' ||
      (p.textTone !== 'light' &&
        liquid &&
        average * (1 - tint) + 29 * tint > 140);
    const foreground = darkText ? '#202127' : '#ffffff',
      secondary = darkText ? '#4c4e58' : liquid ? '#e1e2e8' : '#c7c7c9';
    const track = darkText ? '#686a7280' : '#bbbdbf',
      trackActive = darkText ? '#343640' : '#fafafa';
    ctx.save();
    rounded(ctx, left, cy + padding, cover, cover, cw * 0.02);
    ctx.clip();
    fit(ctx, c, left, cy + padding, cover, cover);
    ctx.restore();
    const baseline = cy + padding + cover;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = secondary;
    ctx.font = `${cw * 0.033}px sans-serif`;
    ctx.fillText(p.device, left, baseline + cw * 0.065, cover);
    ctx.fillStyle = foreground;
    ctx.font = `600 ${cw * 0.05}px sans-serif`;
    ctx.fillText(
      p.title,
      left,
      baseline + cw * 0.118,
      cover * (p.explicit ? 0.88 : 1),
    );
    if (p.explicit) {
      rounded(
        ctx,
        left + cover * 0.93,
        baseline + cw * 0.099,
        cw * 0.032,
        cw * 0.035,
        cw * 0.006,
      );
      ctx.fill();
      ctx.fillStyle = darkText ? '#f5f5f8' : '#555';
      ctx.font = `700 ${cw * 0.027}px sans-serif`;
      ctx.fillText('E', left + cover * 0.934, baseline + cw * 0.118);
    }
    ctx.fillStyle = secondary;
    ctx.font = `${cw * 0.046}px sans-serif`;
    ctx.fillText(p.artist, left, baseline + cw * 0.173, cover);
    const time = (seconds) =>
        `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`,
      py = baseline + cw * 0.265,
      progress = Number(p.progress) / 100,
      duration = Number(p.duration);
    ctx.font = `${cw * 0.03}px sans-serif`;
    ctx.fillText(time(duration * progress), left, py);
    ctx.textAlign = 'right';
    ctx.fillText('-' + time(duration * (1 - progress)), left + cover, py);
    const trackX = left + cover * 0.13,
      trackW = cover * 0.73;
    rounded(ctx, trackX, py - cw * 0.007, trackW, cw * 0.014, cw);
    ctx.fillStyle = track;
    ctx.fill();
    rounded(ctx, trackX, py - cw * 0.007, trackW * progress, cw * 0.014, cw);
    ctx.fillStyle = trackActive;
    ctx.fill();
    const by = baseline + cw * 0.415,
      middle = w / 2;
    ctx.fillStyle = foreground;
    for (const dx of [-0.018, 0.018]) {
      rounded(
        ctx,
        middle + cw * dx - cw * 0.009,
        by - cw * 0.038,
        cw * 0.018,
        cw * 0.076,
        cw * 0.004,
      );
      ctx.fill();
    }
    const triangle = (x, sign) => {
      ctx.beginPath();
      ctx.moveTo(x - sign * cw * 0.022, by - cw * 0.025);
      ctx.lineTo(x + sign * cw * 0.022, by);
      ctx.lineTo(x - sign * cw * 0.022, by + cw * 0.025);
      ctx.closePath();
      ctx.fill();
    };
    for (const sign of [-1, 1]) {
      triangle(middle + sign * cw * 0.19, sign);
      triangle(middle + sign * cw * 0.23, sign);
    }
    const vy = baseline + cw * 0.56;
    rounded(ctx, left + cover * 0.1, vy, cover * 0.78, cw * 0.013, cw);
    ctx.fillStyle = darkText ? track : '#bcbec1';
    ctx.fill();
    rounded(ctx, left + cover * 0.1, vy, cover * 0.43, cw * 0.013, cw);
    ctx.fillStyle = darkText ? foreground : '#eeeeee';
    ctx.fill();
    // Speaker icons are paths so the exported image does not depend on emoji fonts.
    for (const x of [left + cover * 0.025, left + cover * 0.965]) {
      ctx.beginPath();
      ctx.moveTo(x - cw * 0.013, vy);
      ctx.lineTo(x - cw * 0.005, vy);
      ctx.lineTo(x + cw * 0.006, vy - cw * 0.011);
      ctx.lineTo(x + cw * 0.006, vy + cw * 0.024);
      ctx.lineTo(x - cw * 0.005, vy + cw * 0.014);
      ctx.lineTo(x - cw * 0.013, vy + cw * 0.014);
      ctx.closePath();
      ctx.fill();
    }
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
