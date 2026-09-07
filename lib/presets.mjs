export const PRESET_LIMITS = {
  fileBytes: 64 * 1024 * 1024,
  assetBytes: 48 * 1024 * 1024,
  assetCount: 24,
  nodes: 256,
  pixels: 48_000_000,
};
const FRAME = {
  ratio: 'original',
  fit: 'contain',
  background: '#0d0d10',
  offsetX: 50,
  offsetY: 50,
  zoom: 100,
};
const object = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = (message) => {
  throw new Error(`预设无效：${message}`);
};
const own = (value, key) => Object.hasOwn(value, key);
export const presetAssetIds = (document) => [
  ...new Set(
    document.nodes
      .map((node) => node.params.assetId)
      .filter((id) => typeof id === 'string' && id),
  ),
];
export function packPreset(document, encodedAssets) {
  const aliases = new Map(
    presetAssetIds(document).map((id, i) => [id, `asset-${i + 1}`]),
  );
  const assets = {};
  for (const [id, alias] of aliases) {
    const asset = encodedAssets.get(id);
    if (!asset) throw new Error('预设使用的贴图资源不可用');
    assets[alias] = { mime: asset.mime, data: asset.data };
  }
  return {
    format: 'darkroom-preset',
    version: 1,
    canvas: { ...document.canvas },
    output: { ...(document.output ?? FRAME) },
    nodes: document.nodes.map((node) => {
      const params = { ...node.params };
      if (params.assetId) params.assetId = aliases.get(params.assetId);
      return { type: node.type, enabled: node.enabled, params };
    }),
    assets,
  };
}
function frame(value) {
  if (!object(value)) invalid('缺少画布设置');
  if (Object.keys(value).some((key) => !own(FRAME, key)))
    invalid('画布包含未知字段');
  /** @type {import('./editor').Frame} */
  const result = { ...FRAME };
  for (const [key, fallback] of Object.entries(FRAME))
    result[key] = own(value, key) ? value[key] : fallback;
  const ratio = result.ratio;
  if (
    typeof ratio !== 'string' ||
    (ratio !== 'original' && !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(ratio))
  )
    invalid('画布比例格式错误');
  if (ratio !== 'original') {
    const [a, b] = ratio.split(':').map(Number);
    if (!Number.isFinite(a / b) || a / b < 0.1 || a / b > 10)
      invalid('画布比例超出范围');
  }
  if (!['contain', 'cover', 'stretch'].includes(result.fit))
    invalid('未知的图片适配方式');
  if (
    typeof result.background !== 'string' ||
    !/^#[0-9a-f]{6}$/i.test(result.background)
  )
    invalid('画布底色无效');
  for (const key of ['zoom', 'offsetX', 'offsetY']) {
    const n = result[key];
    if (
      typeof n !== 'number' ||
      !Number.isFinite(n) ||
      n < (key === 'zoom' ? 10 : 0) ||
      n > (key === 'zoom' ? 300 : 100)
    )
      invalid('画布位置或缩放超出范围');
  }
  return result;
}
export function validatePreset(value, catalog) {
  if (
    !object(value) ||
    value.format !== 'darkroom-preset' ||
    value.version !== 1
  )
    invalid('请选择暗房导出的 v1 JSON 预设');
  if (!Array.isArray(value.nodes) || value.nodes.length > PRESET_LIMITS.nodes)
    invalid(`最多支持 ${PRESET_LIMITS.nodes} 个效果层`);
  const nodes = value.nodes.map((raw) => {
    if (!object(raw) || typeof raw.type !== 'string' || !own(catalog, raw.type))
      invalid('含有未知效果器');
    if (typeof raw.enabled !== 'boolean' || !object(raw.params))
      invalid('图层参数格式错误');
    const definition = catalog[raw.type],
      defaults = { ...definition.defaults, opacity: 100 },
      params = { ...defaults };
    if (Object.keys(raw.params).some((key) => !own(defaults, key)))
      invalid(`${definition.name} 含有未知参数`);
    for (const [key, fallback] of Object.entries(defaults)) {
      if (!own(raw.params, key)) continue;
      const v = raw.params[key],
        field = definition.fields.find((field) => field.key === key);
      if (typeof v !== typeof fallback)
        invalid(`${definition.name} 参数类型错误`);
      if (typeof v === 'number') {
        const min = field?.min ?? 0,
          max = field?.max ?? 100;
        if (!Number.isFinite(v) || v < min || v > max)
          invalid(`${definition.name} 参数超出范围`);
      }
      if (typeof v === 'string') {
        if (v.length > 1000) invalid('文字内容过长');
        if (field?.kind === 'color' && !/^#[0-9a-f]{6}$/i.test(v))
          invalid('颜色格式错误');
        if (
          field?.kind === 'select' &&
          !field.options.some(([option]) => option === v)
        )
          invalid('未知的选项');
        if (key === 'assetId' && v && !/^asset-\d+$/.test(v))
          invalid('贴图引用格式错误');
      }
      params[key] = v;
    }
    if (raw.type === 'dither' && params.start >= params.fadeEnd)
      invalid('渐暗起点必须小于终点');
    if (raw.type === 'sticker' && !params.assetId) invalid('贴图图层缺少图片');
    return { type: raw.type, enabled: raw.enabled, params };
  });
  const references = presetAssetIds({ nodes });
  if (references.length > PRESET_LIMITS.assetCount || !object(value.assets))
    invalid('贴图数量或格式错误');
  const assets = {};
  let bytes = 0;
  for (const id of references) {
    const asset = own(value.assets, id) ? value.assets[id] : null;
    if (
      !object(asset) ||
      typeof asset.mime !== 'string' ||
      !/^image\/(png|jpeg|webp|avif|gif|bmp)$/.test(asset.mime) ||
      typeof asset.data !== 'string'
    )
      invalid('贴图资源不完整');
    const data = asset.data;
    if (!data.length || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
      invalid('贴图编码错误');
    const size =
      (data.length / 4) * 3 -
      (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
    bytes += size;
    if (size > 32 * 1024 * 1024 || bytes > PRESET_LIMITS.assetBytes)
      invalid('贴图文件总量过大');
    assets[id] = { mime: asset.mime, data };
  }
  return {
    format: 'darkroom-preset',
    version: 1,
    canvas: frame(value.canvas),
    output: frame(value.output ?? FRAME),
    nodes,
    assets,
  };
}
