export type Params = Record<string, string | number | boolean>;
export type Node = {
  id: string;
  type: string;
  enabled: boolean;
  params: Params;
};
export type StudioDocument = {
  sourceId: string;
  canvas: {
    ratio: string;
    fit: string;
    background: string;
    offsetX: number;
    offsetY: number;
    zoom: number;
  };
  nodes: Node[];
};
export type Field = {
  key: string;
  label: string;
  kind: 'number' | 'color' | 'text' | 'select' | 'toggle';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: [string, string][];
};
type Definition = {
  name: string;
  category: string;
  mark: string;
  description: string;
  defaults: Params;
  fields: Field[];
};
const number = (
  key: string,
  label: string,
  min = 0,
  max = 100,
  unit = '%',
  step = 1,
): Field => ({ key, label, min, max, unit, step, kind: 'number' });
const color = (key: string, label: string): Field => ({
  key,
  label,
  kind: 'color',
});
const text = (key: string, label: string): Field => ({
  key,
  label,
  kind: 'text',
});
const select = (
  key: string,
  label: string,
  options: [string, string][],
): Field => ({ key, label, options, kind: 'select' });
const toggle = (key: string, label: string): Field => ({
  key,
  label,
  kind: 'toggle',
});
export const DITHER = {
  pattern: 'tonal',
  cell: 4,
  coverage: 50,
  lift: 32,
  contrast: 105,
  texture: 90,
  fade: 92,
  start: 15,
  brightness: 100,
  color: '#8a76e9',
  background: '#050508',
  middle: '#3e2f84',
  spacing: 100,
  stroke: 30,
  rotation: 0,
  sharpness: 30,
  fadeEnd: 94,
  fadeDirection: 'down',
  vignette: 0,
  grain: 0,
  autoPalette: false,
  sourceColor: 0,
};
const placement = [
  number('x', '水平位置'),
  number('y', '垂直位置'),
  number('width', '宽度', 5, 150),
  number('rotation', '旋转', -180, 180, '°'),
];
export const FILTERS: Record<string, Definition> = {
  adjust: {
    name: '基础调整',
    category: 'basic',
    mark: '◐',
    description: '曝光、色彩与清晰度',
    defaults: {
      exposure: 0,
      contrast: 100,
      saturation: 100,
      warmth: 0,
      gamma: 100,
      sharpness: 0,
    },
    fields: [
      number('exposure', '曝光', -200, 200),
      number('contrast', '对比度', 0, 200),
      number('saturation', '饱和度', 0, 200),
      number('warmth', '色温', -100, 100),
      number('gamma', '暗部提亮', 30, 200),
      number('sharpness', '清晰度'),
    ],
  },
  dither: {
    name: 'Dither 网点',
    category: 'dither',
    mark: '⁙',
    description: '十字层次与八种网点',
    defaults: DITHER,
    fields: [
      select('pattern', '网点形状', [
        ['tonal', '十字层次（参考）'],
        ['bayer', '方点抖色'],
        ['cross', '十字 ＋'],
        ['x', '交叉 ×'],
        ['circle', '圆点 ●'],
        ['square', '方块 ■'],
        ['diamond', '菱形 ◆'],
        ['lines', '平行线'],
      ]),
      number('cell', '网点大小', 1, 12, ''),
      number('coverage', '网点覆盖', 20, 85),
      number('texture', '网点强度'),
      number('spacing', '网点间距', 60, 240),
      number('stroke', '符号笔画', 10, 90),
      number('rotation', '网点旋转', -90, 90, '°'),
      number('lift', '暗部细节', 0, 65),
      number('sharpness', '细节增强'),
      color('color', '主色调'),
      toggle('autoPalette', '主色联动配色'),
      color('middle', '中间色'),
      color('background', '暗部色'),
      number('sourceColor', '保留原图色彩'),
      select('fadeDirection', '渐暗方向', [
        ['down', '向下'],
        ['up', '向上'],
        ['left', '向左'],
        ['right', '向右'],
      ]),
      number('fade', '渐暗强度'),
      number('start', '渐暗起点', 0, 99),
      number('fadeEnd', '渐暗终点', 1, 100),
      number('brightness', '亮度', 50, 160),
      number('contrast', '对比度', 60, 160),
      number('vignette', '暗角'),
      number('grain', '颗粒', 0, 40),
    ],
  },
  bleach: {
    name: '漂白剂',
    category: 'film',
    mark: 'Ag',
    description: '银黑反差 · 低饱和',
    defaults: { saturation: 35, silver: 55, grain: 8 },
    fields: [
      number('saturation', '残留色彩'),
      number('silver', '银黑对比'),
      number('grain', '颗粒'),
    ],
  },
  quarter: {
    name: '1/4″',
    category: 'film',
    mark: '¼',
    description: '低清摄像头 · 蓝晕彩噪',
    defaults: {
      resolution: 640,
      glow: 35,
      noise: 30,
      quality: 80,
      smoothing: 35,
    },
    fields: [
      number('resolution', '传感器长边', 320, 1280, ' px', 20),
      number('glow', '蓝色光晕'),
      number('noise', '彩色噪点'),
      number('quality', 'JPEG 画质', 20, 100),
      number('smoothing', '涂抹柔化'),
    ],
  },
  ccd: {
    name: 'CCD',
    category: 'film',
    mark: '▣',
    description: '紫色高光 · 早期数码',
    defaults: { resolution: 700, glow: 35, grain: 20, flare: 20, quality: 78 },
    fields: [
      number('resolution', '传感器长边', 320, 1600, ' px', 20),
      number('glow', '紫色高光'),
      number('grain', '数码颗粒'),
      number('flare', '镜头反光'),
      number('quality', 'JPEG 画质', 20, 100),
    ],
  },
  threshold: {
    name: '黑白版画',
    category: 'style',
    mark: '◑',
    description: '图 1 · 高反差黑白阈值',
    defaults: {
      threshold: 48,
      detail: 25,
      gray: 0,
      invert: false,
      ink: '#080808',
      paper: '#ffffff',
    },
    fields: [
      number('threshold', '黑白分界', 1, 99),
      number('detail', '边缘细节'),
      number('gray', '灰阶保留'),
      toggle('invert', '黑白反转'),
      color('ink', '墨色'),
      color('paper', '纸色'),
    ],
  },
  bloom: {
    name: 'Bloom',
    category: 'style',
    mark: '✺',
    description: '图 2 · 高光扩散与柔光',
    defaults: { threshold: 60, radius: 25, glow: 65, tint: '#ffffff' },
    fields: [
      number('threshold', '发光阈值'),
      number('radius', '扩散范围', 1, 100),
      number('glow', '光晕强度'),
      color('tint', '光晕颜色'),
    ],
  },
  print: {
    name: '旧纸印刷',
    category: 'style',
    mark: '▧',
    description: '墨点、纸纤维与磨损',
    defaults: { ink: 70, wear: 35, yellow: 12, grain: 40 },
    fields: [
      number('ink', '墨色浓度'),
      number('wear', '油墨磨损'),
      number('yellow', '纸张泛黄'),
      number('grain', '纸面颗粒'),
    ],
  },
  wanted: {
    name: '通缉海报',
    category: 'layout',
    mark: 'W',
    description: '图 3 · 红标题与旧报纸版面',
    defaults: {
      title: 'HAVE YOU SEEN THIS PERSON?',
      caption: 'LAST SEEN / UNKNOWN',
      footer: 'POSSIBLE APPEARANCE',
      layout: 'double',
      stamp: true,
      ink: 75,
      wear: 30,
      titleColor: '#a9211d',
      photoZoom: 100,
      photoX: 50,
      photoY: 50,
      assetId: '',
    },
    fields: [
      text('title', '海报标题'),
      text('caption', '左栏说明'),
      text('footer', '右栏说明'),
      select('layout', '版面', [
        ['double', '双栏图片'],
        ['single', '单张肖像'],
      ]),
      color('titleColor', '标题颜色'),
      toggle('stamp', '装饰印章'),
      number('photoZoom', '左图放大', 100, 250),
      number('photoX', '左图水平裁切'),
      number('photoY', '左图垂直裁切'),
      number('ink', '黑白印刷'),
      number('wear', '纸面磨损'),
    ],
  },
  music: {
    name: 'iOS 专辑卡片',
    category: 'layout',
    mark: '♫',
    description: '图 4 · 模糊背景与玻璃播放器',
    defaults: {
      title: 'Untitled',
      artist: 'Unknown Artist',
      device: 'iPhone',
      progress: 48,
      duration: 180,
      glass: 58,
      blur: 65,
      size: 84,
      roundness: 12,
      explicit: false,
    },
    fields: [
      text('title', '专辑 / 歌曲名'),
      text('artist', '艺术家'),
      text('device', '设备文字'),
      number('progress', '播放进度'),
      number('duration', '总时长', 30, 600, ' 秒'),
      number('glass', '玻璃深度'),
      number('blur', '背景模糊', 5, 100),
      number('size', '卡片宽度', 65, 92),
      number('roundness', '卡片圆角', 0, 20),
      toggle('explicit', 'Explicit 标记'),
    ],
  },
  text: {
    name: '文字图层',
    category: 'basic',
    mark: 'T',
    description: '可编辑文字、位置与旋转',
    defaults: {
      text: 'YOUR TEXT',
      x: 50,
      y: 80,
      width: 80,
      rotation: 0,
      size: 7,
      color: '#ffffff',
      outline: '#000000',
      stroke: 0,
      font: 'sans-serif',
      bold: true,
      align: 'center',
    },
    fields: [
      text('text', '文字（支持换行）'),
      ...placement,
      number('size', '字号 / 短边', 1, 30),
      color('color', '文字颜色'),
      color('outline', '描边颜色'),
      number('stroke', '描边粗细', 0, 15),
      select('font', '字体', [
        ['sans-serif', '无衬线'],
        ['serif', '衬线'],
        ['monospace', '等宽'],
      ]),
      toggle('bold', '粗体'),
      select('align', '对齐', [
        ['left', '左对齐'],
        ['center', '居中'],
        ['right', '右对齐'],
      ]),
    ],
  },
  sticker: {
    name: '贴图图层',
    category: 'basic',
    mark: '▨',
    description: '叠加图片，保留透明背景',
    defaults: { assetId: '', x: 50, y: 50, width: 35, rotation: 0 },
    fields: placement,
  },
};
export const CATEGORIES: [string, string][] = [
  ['basic', '基础'],
  ['dither', 'Dither'],
  ['film', 'Bleach Bypass'],
  ['style', '风格'],
  ['layout', '构图'],
];
let idSequence = 0;
// getRandomValues also works on an HTTP LAN origin; randomUUID requires HTTPS.
export const newId = (): string =>
  `${Date.now().toString(36)}-${++idSequence}-${Array.from(globalThis.crypto.getRandomValues(new Uint32Array(2)), (value) => value.toString(36)).join('-')}`;
export const makeNode = (type: string): Node => ({
  id: newId(),
  type,
  enabled: true,
  params: { ...FILTERS[type].defaults, opacity: 100 },
});
export const blankDocument = (): StudioDocument => ({
  sourceId: '',
  canvas: {
    ratio: 'original',
    fit: 'cover',
    background: '#ffffff',
    offsetX: 50,
    offsetY: 50,
    zoom: 100,
  },
  nodes: [],
});
