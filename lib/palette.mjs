const bound = (value) => Math.max(0, Math.min(255, Math.round(value)));
const hex = (color) =>
  '#' +
  color.map((value) => bound(value).toString(16).padStart(2, '0')).join('');
const luminance = (color) =>
  0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
export function paletteFromPrimary(color) {
  const rgb = [1, 3, 5].map((index) =>
    parseInt(color.slice(index, index + 2), 16),
  );
  return {
    color,
    middle: hex(rgb.map((value) => value * 0.43)),
    background: hex(rgb.map((value) => 3 + value * 0.035)),
  };
}
export function extractPalette(data) {
  const bins = new Map();
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] < 128) continue;
    const color = [data[index], data[index + 1], data[index + 2]];
    const key = color.map((value) => Math.floor(value / 24)).join(',');
    const bin = bins.get(key) ?? { sum: [0, 0, 0], count: 0 };
    bin.count++;
    color.forEach((value, channel) => (bin.sum[channel] += value));
    bins.set(key, bin);
  }
  if (!bins.size) return paletteFromPrimary('#b6b6b6');
  const colors = [...bins.values()].map((bin) => ({
    color: bin.sum.map((value) => value / bin.count),
    count: bin.count,
  }));
  const weighted = colors.map((bin) => ({
    ...bin,
    score:
      bin.count *
      (0.3 + (Math.max(...bin.color) - Math.min(...bin.color)) / 100),
  }));
  const candidates = weighted.filter(
    (bin) => luminance(bin.color) > 35 && luminance(bin.color) < 240,
  );
  const dominant = (candidates.length ? candidates : weighted).sort(
    (a, b) => b.score - a.score,
  )[0].color;
  const dark = [...colors].sort(
    (a, b) => luminance(a.color) - luminance(b.color),
  )[0].color;
  const light = dominant.map((value) => value + (255 - value) * 0.4);
  return {
    color: hex(light),
    middle: hex(dominant.map((value) => value * 0.7)),
    background: hex(dark.map((value) => value * 0.12)),
  };
}
