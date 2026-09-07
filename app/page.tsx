'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Check,
  Copy,
  Expand,
  ImagePlus,
  Layers,
  LoaderCircle,
  Plus,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createComparisonDrag, splitByKey } from '@/lib/comparison.mjs';
import {
  createHistory,
  currentDocument,
  stageHistory,
  commitHistory,
  jumpHistory,
  moveNode,
} from '@/lib/history.mjs';
import { extractPalette, paletteFromPrimary } from '@/lib/palette.mjs';
import {
  blankDocument,
  CATEGORIES,
  DITHER,
  FILTERS,
  makeNode,
  newId,
  type Field,
  type Node,
  type Params,
  type StudioDocument,
} from '@/lib/editor';

type History = {
  entries: { document: StudioDocument; label: string }[];
  cursor: number;
  draft: StudioDocument | null;
  draftLabel: string;
};
type Asset = {
  id: string;
  name: string;
  width: number;
  height: number;
  url: string;
  blob: Blob;
};
type Job = {
  type: string;
  id: number;
  revision: number;
  document: StudioDocument;
  maxSize: number;
};
function Choice({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: string;
  items: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(value) => {
        if (value) onChange(value);
      }}
    >
      <SelectTrigger aria-label={label}>
        <SelectValue>
          {items.find((item) => item[0] === value)?.[1] ?? value}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map(([id, name]) => (
          <SelectItem value={id} key={id}>
            {name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
function Control({
  field,
  value,
  onChange,
  onCommit,
}: {
  field: Field;
  value: string | number | boolean;
  onChange: (value: string | number | boolean, draft?: boolean) => void;
  onCommit: () => void;
}) {
  if (field.kind === 'number')
    return (
      <div className="control range">
        <div className="control-heading">
          <label>{field.label}</label>
          <output>
            {value}
            {field.unit}
          </output>
        </div>
        <Slider
          aria-label={field.label}
          min={field.min ?? 0}
          max={field.max ?? 100}
          step={field.step ?? 1}
          value={[Number(value)]}
          onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v, true)}
          onValueCommitted={(v) => {
            onChange(Array.isArray(v) ? v[0] : v, true);
            onCommit();
          }}
        />
      </div>
    );
  if (field.kind === 'toggle')
    return (
      <div className="control inline-control">
        <label>{field.label}</label>
        <Switch
          aria-label={field.label}
          checked={Boolean(value)}
          onCheckedChange={(v) => onChange(v)}
        />
      </div>
    );
  if (field.kind === 'select')
    return (
      <div className="control">
        <label className="field-label">{field.label}</label>
        <Choice
          label={field.label}
          value={String(value)}
          items={field.options!}
          onChange={(v) => onChange(v)}
        />
      </div>
    );
  if (field.kind === 'color')
    return (
      <label className="control color-control">
        <span>
          {field.label}
          <small>{String(value).toUpperCase()}</small>
        </span>
        <input
          aria-label={field.label}
          type="color"
          value={String(value)}
          onChange={(e) => onChange(e.target.value, true)}
          onBlur={onCommit}
        />
      </label>
    );
  return (
    <label className="control">
      <span className="field-label">{field.label}</span>
      <textarea
        rows={field.key === 'text' ? 3 : 2}
        maxLength={1000}
        value={String(value)}
        onChange={(e) => onChange(e.target.value, true)}
        onBlur={onCommit}
      />
    </label>
  );
}
export default function Home() {
  const [history, setHistory] = useState<History>(
      () => createHistory(blankDocument(), '开始') as History,
    ),
    historyRef = useRef(history);
  const doc = currentDocument(history) as StudioDocument,
    docRef = useRef(doc);
  docRef.current = doc;
  const [selectedId, setSelectedId] = useState(''),
    [category, setCategory] = useState('dither'),
    [view, setView] = useState('effect'),
    [split, setSplit] = useState(50),
    [zoom, setZoom] = useState(false);
  const [working, setWorking] = useState(true),
    [loading, setLoading] = useState(false),
    [exporting, setExporting] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [dimensions, setDimensions] = useState([1200, 1060]),
    [exportSize, setExportSize] = useState('original'),
    [assetTick, setAssetTick] = useState(0),
    [customRatio, setCustomRatio] = useState('4:5'),
    [dropActive, setDropActive] = useState(false);
  const assets = useRef(new Map<string, Asset>()),
    workerRef = useRef<Worker | null>(null),
    canvasRef = useRef<HTMLCanvasElement>(null),
    originalRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null),
    stickerRef = useRef<HTMLInputElement>(null),
    photoRef = useRef<HTMLInputElement>(null),
    photoTarget = useRef('');
  const requests = useRef(0),
    revision = useRef(0),
    inFlight = useRef<number | null>(null),
    pending = useRef<Job | null>(null),
    assetWaiters = useRef(
      new Map<string, { resolve: () => void; reject: (e: Error) => void }>(),
    ),
    exportJobs = useRef(new Map<number, string>()),
    importTicket = useRef(0),
    transaction = useRef('');
  const historyTrack = useRef<HTMLElement>(null);
  const comparisonDrag = useMemo(() => createComparisonDrag(setSplit), []);
  const source = assets.current.get(doc.sourceId),
    selected = doc.nodes.find((node) => node.id === selectedId),
    definition = selected ? FILTERS[selected.type] : null;
  const publish = useCallback((next: History) => {
    if (currentDocument(historyRef.current) !== currentDocument(next)) {
      revision.current++;
      pending.current = null;
    }
    historyRef.current = next;
    docRef.current = currentDocument(next);
    setHistory(next);
  }, []);
  const finish = useCallback(() => {
    transaction.current = '';
    publish(commitHistory(historyRef.current));
  }, [publish]);
  const edit = useCallback(
    (
      update: (document: StudioDocument) => StudioDocument,
      label: string,
      draft = false,
      key = label,
    ) => {
      let state = historyRef.current;
      if (!draft || transaction.current !== key) state = commitHistory(state);
      transaction.current = draft ? key : '';
      const next = stageHistory(
        state,
        update(currentDocument(state)),
        label,
      ) as History;
      publish(draft ? next : commitHistory(next));
    },
    [publish],
  );
  const navigate = useCallback(
    (where: number | 'undo' | 'redo') => {
      const state = commitHistory(historyRef.current),
        cursor =
          where === 'undo'
            ? state.cursor - 1
            : where === 'redo'
              ? state.cursor + 1
              : where;
      transaction.current = '';
      publish(jumpHistory(state, cursor));
    },
    [publish],
  );
  const changeNode = useCallback(
    (id: string, patch: Params, label: string, draft = false, key = label) => {
      edit(
        (document) => ({
          ...document,
          nodes: document.nodes.map((node) =>
            node.id === id
              ? { ...node, params: { ...node.params, ...patch } }
              : node,
          ),
        }),
        label,
        draft,
        id + key,
      );
    },
    [edit],
  );
  const pump = useCallback(() => {
    if (inFlight.current !== null || !pending.current || !workerRef.current)
      return;
    if (pending.current.revision !== revision.current) {
      pending.current = null;
      return;
    }
    const job = pending.current;
    pending.current = null;
    inFlight.current = job.id;
    workerRef.current.postMessage(job);
  }, []);
  const releaseUnusedAsset = useCallback((asset: Asset) => {
    URL.revokeObjectURL(asset.url);
    assets.current.delete(asset.id);
    workerRef.current?.postMessage({
      type: 'release-unused-asset',
      assetId: asset.id,
    });
  }, []);
  const registerAsset = useCallback(
    async (blob: Blob, name: string): Promise<Asset> => {
      if (blob.size > 32 * 1024 * 1024)
        throw new Error('图片超过 32 MB，请先压缩后再导入。');
      if (!/^image\/(jpeg|png|webp|avif|gif|bmp)$/.test(blob.type))
        throw new Error('请使用 JPG、PNG、WebP、AVIF、GIF 或 BMP 图片。');
      const worker = workerRef.current,
        bitmap = await createImageBitmap(blob, {
          imageOrientation: 'from-image',
        });
      if (
        bitmap.width * bitmap.height > 32_000_000 ||
        Math.max(bitmap.width, bitmap.height) > 16384
      ) {
        bitmap.close();
        throw new Error('图片不能超过 3200 万像素或单边 16384 px。');
      }
      if (!worker || worker !== workerRef.current) {
        bitmap.close();
        throw new Error('图像处理器尚未就绪，请刷新后重试。');
      }
      const id = newId(),
        asset = {
          id,
          name,
          width: bitmap.width,
          height: bitmap.height,
          url: URL.createObjectURL(blob),
          blob,
        };
      assets.current.set(id, asset);
      await new Promise<void>((resolve, reject) => {
        assetWaiters.current.set(id, { resolve, reject });
        worker.postMessage({ type: 'asset', assetId: id, bitmap }, [bitmap]);
      });
      setAssetTick((tick) => tick + 1);
      return asset;
    },
    [],
  );
  const load = useCallback(
    async (file?: File) => {
      const ticket = ++importTicket.current;
      setLoading(true);
      setError('');
      try {
        const response = file ? null : await fetch('/sample.jpg');
        if (response && !response.ok)
          throw new Error('示例图片暂时无法加载，请上传图片。');
        const asset = await registerAsset(
          file ?? (await response!.blob()),
          file?.name ?? '示例人像.jpg',
        );
        if (ticket !== importTicket.current) {
          releaseUnusedAsset(asset);
          return;
        }
        if (
          !docRef.current.sourceId &&
          historyRef.current.entries.length === 1
        ) {
          const node = makeNode('dither'),
            initial = { ...blankDocument(), sourceId: asset.id, nodes: [node] };
          publish(
            createHistory(
              initial,
              file ? '导入图片' : '示例 · 参考紫黑',
            ) as History,
          );
          setSelectedId(node.id);
        } else
          edit((document) => ({ ...document, sourceId: asset.id }), '更换原图');
        if (file?.type === 'image/gif') setNotice('GIF 将使用第一帧静态画面。');
      } catch (e) {
        if (ticket === importTicket.current) {
          setError(e instanceof Error ? e.message : '无法读取图片');
          setWorking(false);
        }
      } finally {
        if (ticket === importTicket.current) setLoading(false);
      }
    },
    [edit, publish, registerAsset, releaseUnusedAsset],
  );
  useEffect(() => {
    const worker = new Worker('/editor-worker.js?v=5');
    workerRef.current = worker;
    worker.onmessage = (event) => {
      const m = event.data;
      if (m.type === 'asset') {
        assetWaiters.current.get(m.assetId)?.resolve();
        assetWaiters.current.delete(m.assetId);
        return;
      }
      if (m.type === 'preview') {
        if (inFlight.current === m.id) inFlight.current = null;
        if (m.revision === revision.current) {
          for (const [ref, bitmap] of [
            [canvasRef, m.bitmap],
            [originalRef, m.reference],
          ] as const) {
            const c = ref.current;
            if (c) {
              c.width = m.width;
              c.height = m.height;
              c.getContext('2d')!.drawImage(bitmap, 0, 0);
            }
          }
          setDimensions([m.width, m.height]);
          setWorking(false);
        }
        m.bitmap.close();
        m.reference.close();
        pump();
        return;
      }
      if (m.type === 'export') {
        const name = exportJobs.current.get(m.id);
        if (!name) return;
        exportJobs.current.delete(m.id);
        const url = URL.createObjectURL(m.blob),
          link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        setExporting(exportJobs.current.size > 0);
        setNotice(`PNG 已生成 · ${m.width} × ${m.height}`);
        return;
      }
      if (m.type === 'error') {
        if (m.job === 'export' && exportJobs.current.has(m.id)) {
          exportJobs.current.delete(m.id);
          setExporting(exportJobs.current.size > 0);
          setError(m.message);
        } else if (m.job === 'preview') {
          if (inFlight.current === m.id) inFlight.current = null;
          if (m.revision === revision.current) {
            setError(m.message);
            setWorking(false);
          }
          pump();
        }
      }
    };
    worker.onerror = () => {
      setError('图像处理器遇到错误，请刷新页面后重试。');
      setWorking(false);
      setExporting(false);
      for (const waiter of assetWaiters.current.values())
        waiter.reject(new Error('图像处理器已停止'));
      assetWaiters.current.clear();
    };
    void load();
    return () => {
      importTicket.current++;
      worker.terminate();
      workerRef.current = null;
      inFlight.current = null;
      pending.current = null;
      for (const asset of assets.current.values())
        URL.revokeObjectURL(asset.url);
      assets.current.clear();
    };
  }, [load, pump]);
  useEffect(() => {
    if (!doc.sourceId || !assets.current.has(doc.sourceId)) {
      setWorking(false);
      return;
    }
    setWorking(true);
    setError('');
    const job: Job = {
      type: 'preview',
      id: ++requests.current,
      revision: revision.current,
      document: doc,
      maxSize: 1400,
    };
    const timer = setTimeout(() => {
      pending.current = job;
      pump();
    }, 55);
    return () => clearTimeout(timer);
  }, [doc, assetTick, pump]);
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        target.closest('input,textarea,[contenteditable="true"]') ||
        event.isComposing
      )
        return;
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === 'z') {
        event.preventDefault();
        navigate(event.shiftKey ? 'redo' : 'undo');
      } else if (event.key.toLowerCase() === 'y') {
        event.preventDefault();
        navigate('redo');
      }
    };
    const paste = (event: ClipboardEvent) => {
      if (
        (event.target as HTMLElement).closest(
          'textarea,input,[contenteditable="true"]',
        )
      )
        return;
      const file = Array.from(event.clipboardData?.files ?? []).find((f) =>
        f.type.startsWith('image/'),
      );
      if (file) {
        event.preventDefault();
        void load(file);
      }
    };
    window.addEventListener('keydown', keys);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('keydown', keys);
      window.removeEventListener('paste', paste);
    };
  }, [load, navigate]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(''), 5000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    if (doc.canvas.ratio !== 'original') setCustomRatio(doc.canvas.ratio);
  }, [doc.canvas.ratio]);
  useEffect(() => {
    historyTrack.current
      ?.querySelector('[aria-current=step]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [history.cursor, history.entries.length]);
  const add = useCallback(
    (type: string) => {
      if (type === 'sticker') {
        stickerRef.current?.click();
        return;
      }
      const node = makeNode(type);
      edit(
        (document) => ({ ...document, nodes: [...document.nodes, node] }),
        `添加 ${FILTERS[type].name}`,
      );
      setSelectedId(node.id);
    },
    [edit],
  );
  const addRecipe = (types: string[], label: string) => {
    const nodes = types.map(makeNode);
    edit(
      (document) => ({ ...document, nodes: [...document.nodes, ...nodes] }),
      label,
    );
    setSelectedId(nodes[nodes.length - 1].id);
  };
  const addSticker = async (file: File) => {
    try {
      setLoading(true);
      const asset = await registerAsset(file, file.name),
        node = makeNode('sticker');
      node.params.assetId = asset.id;
      edit(
        (document) => ({ ...document, nodes: [...document.nodes, node] }),
        '添加贴图',
      );
      setSelectedId(node.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : '贴图读取失败');
    } finally {
      setLoading(false);
    }
  };
  const replacePhoto = async (file: File) => {
    const target = photoTarget.current;
    try {
      setLoading(true);
      const asset = await registerAsset(file, file.name);
      if (docRef.current.nodes.some((n) => n.id === target))
        changeNode(target, { assetId: asset.id }, '更换图层图片');
      else releaseUnusedAsset(asset);
    } catch (e) {
      setError(e instanceof Error ? e.message : '图片读取失败');
    } finally {
      setLoading(false);
    }
  };
  const parameter = (
    node: Node,
    field: Field,
    value: string | number | boolean,
    draft = false,
  ) => {
    const patch: Params = { [field.key]: value };
    if (node.type === 'dither') {
      if (
        (field.key === 'color' && node.params.autoPalette) ||
        (field.key === 'autoPalette' && value)
      )
        Object.assign(
          patch,
          paletteFromPrimary(
            field.key === 'color' ? String(value) : String(node.params.color),
          ),
        );
      if (['middle', 'background'].includes(field.key))
        patch.autoPalette = false;
      if (field.key === 'start')
        patch.fadeEnd = Math.max(
          Number(value) + 1,
          Number(node.params.fadeEnd),
        );
      if (field.key === 'fadeEnd')
        patch.start = Math.min(Number(value) - 1, Number(node.params.start));
    }
    changeNode(node.id, patch, `调整 ${field.label}`, draft, field.key);
  };
  const getSourceColors = async () => {
    if (!source || !selected) return;
    const id = selected.id;
    try {
      const bitmap = await createImageBitmap(source.blob),
        canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0, 128, 128);
      bitmap.close();
      const palette = extractPalette(ctx.getImageData(0, 0, 128, 128).data);
      if (docRef.current.nodes.some((n) => n.id === id))
        changeNode(id, { ...palette, autoPalette: false }, '读取原图配色');
      setNotice('已从原图提取主色、中间色和暗部色');
    } catch {
      setError('读取原图颜色失败，请重试。');
    }
  };
  const exportImage = () => {
    if (!docRef.current.sourceId || exporting || loading) return;
    finish();
    const snapshot = structuredClone(docRef.current),
      id = ++requests.current,
      asset = assets.current.get(snapshot.sourceId);
    exportJobs.current.set(
      id,
      `${asset?.name.replace(/\.[^.]+$/, '') ?? 'image'}-darkroom.png`,
    );
    setExporting(true);
    setError('');
    workerRef.current?.postMessage({
      type: 'export',
      id,
      revision: revision.current,
      document: snapshot,
      maxSize: exportSize === 'original' ? 0 : Number(exportSize),
    });
  };
  // The imperative surface follows the same visible, undoable editing actions.
  useEffect(() => {
    type ModelContext = {
      registerTool: (
        tool: {
          name: string;
          description: string;
          inputSchema: object;
          annotations: object;
          execute: (input: unknown) => unknown;
        },
        options: { signal: AbortSignal },
      ) => unknown;
    };
    const context = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    const register = (tool: Parameters<ModelContext['registerTool']>[0]) => {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    };
    register({
      name: 'get_editor_state',
      description:
        'Read the local canvas, ordered filter stack and current history position.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute: () => ({
        document: docRef.current,
        historyPosition: historyRef.current.cursor,
        steps: historyRef.current.entries.length,
      }),
    });
    register({
      name: 'add_image_filter',
      description:
        'Add a visible filter to the end of the current stack. This operation can be undone and does not export or upload images.',
      inputSchema: {
        type: 'object',
        properties: {
          filter: {
            type: 'string',
            enum: Object.keys(FILTERS).filter((k) => k !== 'sticker'),
          },
        },
        required: ['filter'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: (input) => {
        const filter = (input as { filter?: string })?.filter;
        if (!filter || !FILTERS[filter] || filter === 'sticker')
          throw new Error('Unknown filter');
        add(filter);
        return { added: filter };
      },
    });
    return () => lifecycle.abort();
  }, [add]);
  const changeCanvas = (
    key: keyof StudioDocument['canvas'],
    value: string | number,
    draft = false,
  ) =>
    edit(
      (document) => ({
        ...document,
        canvas: { ...document.canvas, [key]: value },
      }),
      '调整画布',
      draft,
      'canvas-' + key,
    );
  return (
    <main
      className="studio"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropActive(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node))
          setDropActive(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDropActive(false);
        if (e.dataTransfer.files[0]) void load(e.dataTransfer.files[0]);
      }}
    >
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark" />
          <span>
            暗房<span className="brand-en">DARKROOM / IMAGE LAB</span>
          </span>
        </a>
        <span className="local-badge">
          <i />
          本机处理 · 自由叠加
        </span>
        <div className="top-actions">
          <button
            className="quiet-button"
            disabled={loading}
            onClick={() => fileRef.current?.click()}
          >
            <ImagePlus size={16} />
            <span>更换图片</span>
          </button>
          <button
            className="primary-button"
            onClick={exportImage}
            disabled={!source || loading || exporting}
          >
            {exporting ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <ArrowDownToLine size={17} />
            )}
            <span>{exporting ? '正在导出' : '导出 PNG'}</span>
          </button>
        </div>
      </header>
      <input
        ref={fileRef}
        type="file"
        className="sr-only"
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp"
        onChange={(e) => {
          if (e.target.files?.[0]) void load(e.target.files[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={stickerRef}
        type="file"
        className="sr-only"
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp"
        onChange={(e) => {
          if (e.target.files?.[0]) void addSticker(e.target.files[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={photoRef}
        type="file"
        className="sr-only"
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp"
        onChange={(e) => {
          if (e.target.files?.[0]) void replacePhoto(e.target.files[0]);
          e.target.value = '';
        }}
      />
      <div className="editor-grid">
        <aside className="library-panel">
          <div className="panel-heading">
            <span className="eyebrow">01 / 工具箱</span>
            <h1>让一张图，有更多可能。</h1>
            <p>选择效果，添加到你的作品。</p>
          </div>
          <button
            className="start-original"
            disabled={!source || !doc.nodes.length}
            onClick={() => {
              edit((d) => ({ ...d, nodes: [] }), '从原图重新开始');
              setSelectedId('');
            }}
          >
            从原图开始 <span>清空效果 · 可撤销</span>
          </button>
          <Tabs
            value={category}
            onValueChange={(v) => setCategory(String(v))}
            className="library-tabs"
          >
            <TabsList aria-label="滤镜分类" className="category-tabs">
              {CATEGORIES.map(([id, name]) => (
                <TabsTrigger key={id} value={id}>
                  {name}
                </TabsTrigger>
              ))}
            </TabsList>
            {CATEGORIES.map(([id]) => (
              <TabsContent value={id} key={id}>
                <div className="filter-library">
                  {Object.entries(FILTERS)
                    .filter(([, filter]) => filter.category === id)
                    .map(([type, filter]) => (
                      <button
                        key={type}
                        className={`filter-tile tile-${type}`}
                        disabled={!source || loading}
                        onClick={() => add(type)}
                      >
                        <span className="filter-mark" aria-hidden="true">
                          {filter.mark}
                        </span>
                        <span>
                          <strong>{filter.name}</strong>
                          <small>{filter.description}</small>
                        </span>
                        <Plus size={15} />
                      </button>
                    ))}
                </div>
                {id === 'film' && (
                  <p className="helper">
                    参考 Bleach Bypass
                    的独立风格近似，支持调整强度；不使用原应用的 LUT。
                  </p>
                )}
                {id === 'style' && (
                  <button
                    className="recipe-button"
                    disabled={!source}
                    onClick={() =>
                      addRecipe(['threshold', 'bloom'], '添加 黑白 Bloom 组合')
                    }
                  >
                    ＋ 黑白版画 → Bloom<span>参考图 2 的两步组合</span>
                  </button>
                )}
                {id === 'layout' && (
                  <p className="helper">
                    构图也参与叠加。可先做通缉海报，再添加专辑卡片。卡片中的播放控件作为图片装饰导出。
                  </p>
                )}
              </TabsContent>
            ))}
          </Tabs>
          <details
            className="canvas-settings"
            open={category === 'basic' ? true : undefined}
          >
            <summary>
              画布与裁切 <span>Aspect ratio</span>
            </summary>
            <div className="control">
              <label className="field-label">画布比例</label>
              <Choice
                label="画布比例"
                value={
                  [
                    'original',
                    '1:1',
                    '4:5',
                    '3:4',
                    '9:16',
                    '16:9',
                    '4:3',
                  ].includes(doc.canvas.ratio)
                    ? doc.canvas.ratio
                    : 'custom'
                }
                items={[
                  ['original', '原图比例'],
                  ['1:1', '1 : 1'],
                  ['4:5', '4 : 5'],
                  ['3:4', '3 : 4'],
                  ['9:16', '9 : 16'],
                  ['16:9', '16 : 9'],
                  ['4:3', '4 : 3'],
                  ['custom', '自定义比例'],
                ]}
                onChange={(v) => {
                  if (v === 'custom') {
                    setCustomRatio('5:4');
                    changeCanvas('ratio', '5:4');
                  } else changeCanvas('ratio', v);
                }}
              />
            </div>
            {!['original', '1:1', '4:5', '3:4', '9:16', '16:9', '4:3'].includes(
              doc.canvas.ratio,
            ) && (
              <div className="custom-ratio">
                <input
                  aria-label="自定义比例，例如 5:4"
                  value={customRatio}
                  onChange={(e) => setCustomRatio(e.target.value)}
                />
                <button
                  onClick={() => {
                    const match = customRatio.match(
                      /^(\d+(?:\.\d+)?)\s*[:：/]\s*(\d+(?:\.\d+)?)$/,
                    );
                    if (
                      !match ||
                      !Number.isFinite(Number(match[1]) / Number(match[2])) ||
                      Number(match[1]) / Number(match[2]) < 0.1 ||
                      Number(match[1]) / Number(match[2]) > 10
                    ) {
                      setError('请输入 1:10 到 10:1 之间的比例，例如 5:4。');
                      return;
                    }
                    changeCanvas(
                      'ratio',
                      `${Number(match[1])}:${Number(match[2])}`,
                    );
                  }}
                >
                  应用
                </button>
              </div>
            )}
            <Control
              field={{
                key: 'fit',
                label: '图片适配',
                kind: 'select',
                options: [
                  ['cover', '填满画布 / 裁切'],
                  ['contain', '完整图片 / 留边'],
                ],
              }}
              value={doc.canvas.fit}
              onChange={(v) => changeCanvas('fit', String(v))}
              onCommit={finish}
            />
            <Control
              field={{ key: 'background', label: '画布底色', kind: 'color' }}
              value={doc.canvas.background}
              onChange={(v, draft) =>
                changeCanvas('background', String(v), draft)
              }
              onCommit={finish}
            />
            {(
              [
                ['zoom', '图片缩放', 100, 300],
                ['offsetX', '水平裁切', 0, 100],
                ['offsetY', '垂直裁切', 0, 100],
              ] as const
            ).map(([key, label, min, max]) => (
              <Control
                key={key}
                field={{ key, label, kind: 'number', min, max, unit: '%' }}
                value={doc.canvas[key]}
                onChange={(v, draft) => changeCanvas(key, Number(v), draft)}
                onCommit={finish}
              />
            ))}
            <p className="helper">
              保留原图长边，按比例裁切或留边。海报与专辑卡片会建立自己的版面比例。
            </p>
          </details>
          <button
            className="sample-button"
            disabled={loading}
            onClick={() => void load()}
          >
            载入示例图片 ↗
          </button>
          <p className="privacy-note">
            拖入、粘贴或上传图片。原图与历史仅保留在当前页面，刷新后清空。
          </p>
        </aside>
        <section className="preview-panel" aria-label="图片工作区">
          <div className="preview-toolbar">
            <div className="file-meta">
              <span title={source?.name}>{source?.name ?? '选择一张图片'}</span>
              <small>
                {source
                  ? `${source.width} × ${source.height}`
                  : 'JPG / PNG / WebP'}
              </small>
            </div>
            <Choice
              label="预览模式"
              value={view}
              onChange={setView}
              items={[
                ['effect', '效果预览'],
                ['original', '查看原图'],
                ['compare', '滑动对比'],
              ]}
            />
            <button
              className="icon-button"
              aria-label={zoom ? '适应画布' : '放大预览'}
              title={zoom ? '适应画布' : '放大预览'}
              onClick={() => setZoom((v) => !v)}
            >
              <Expand size={15} />
            </button>
          </div>
          <div className={`preview-stage ${zoom ? 'zoomed' : ''}`}>
            <div
              className={`image-frame ${view === 'compare' ? 'comparing' : ''}`}
              style={
                {
                  '--ratio': dimensions[0] / dimensions[1],
                  aspectRatio: `${dimensions[0]}/${dimensions[1]}`,
                } as React.CSSProperties
              }
              onPointerDown={
                view === 'compare' ? comparisonDrag.down : undefined
              }
              onPointerMove={
                view === 'compare' ? comparisonDrag.move : undefined
              }
              onPointerUp={comparisonDrag.end}
              onPointerCancel={comparisonDrag.end}
              onLostPointerCapture={comparisonDrag.lost}
            >
              <canvas
                ref={canvasRef}
                className="result-canvas"
                aria-label="按顺序应用全部图层后的图片"
              />
              <canvas
                ref={originalRef}
                className="original-canvas"
                aria-label="原图对照"
                style={{
                  visibility: view === 'effect' ? 'hidden' : 'visible',
                  clipPath:
                    view === 'compare'
                      ? `inset(0 ${100 - split}% 0 0)`
                      : undefined,
                }}
              />
              {view === 'compare' && (
                <>
                  <div className="compare-line" style={{ left: `${split}%` }}>
                    <button
                      className="compare-handle"
                      role="slider"
                      aria-label="原图与效果分界线"
                      aria-orientation="horizontal"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(split)}
                      onKeyDown={(e) => {
                        if (
                          [
                            'ArrowLeft',
                            'ArrowRight',
                            'ArrowDown',
                            'ArrowUp',
                            'Home',
                            'End',
                          ].includes(e.key)
                        ) {
                          e.preventDefault();
                          setSplit((v) => splitByKey(e.key, v, e.shiftKey));
                        }
                      }}
                    >
                      ‹ ›
                    </button>
                  </div>
                  <span className="image-label original-label">原图</span>
                  <span className="image-label effect-label">效果</span>
                </>
              )}
              {!source && (
                <div className="empty-preview">
                  <ImagePlus size={32} />
                  <button onClick={() => fileRef.current?.click()}>
                    选择图片开始创作
                  </button>
                </div>
              )}
            </div>
            {loading && (
              <span className="stage-status">
                <LoaderCircle size={14} className="spin" />
                正在读取图片
              </span>
            )}
          </div>
          {view === 'compare' && (
            <div className="compare-control">
              <span>原图</span>
              <Slider
                aria-label="对比分界线"
                min={0}
                max={100}
                value={[split]}
                onValueChange={(v) => setSplit(Array.isArray(v) ? v[0] : v)}
              />
              <span>效果</span>
            </div>
          )}
          <div className="preview-footer">
            <span role="status" className="render-status">
              <i className={working ? 'busy' : ''} />
              {working ? '正在更新' : '预览已更新'}
              <small>
                {dimensions[0]} × {dimensions[1]}
              </small>
            </span>
            <Choice
              label="导出尺寸"
              value={exportSize}
              onChange={setExportSize}
              items={[
                ['original', '原图长边'],
                ['2048', '长边 2048 px'],
                ['1200', '长边 1200 px'],
              ]}
            />
          </div>
          <p className="stage-note">
            从上到下依次生效。导出重新计算效果，最高 3200 万像素。
          </p>
        </section>
        <aside className="layers-panel">
          <div className="stack-heading">
            <span className="eyebrow">02 / 效果叠加</span>
            <span>{doc.nodes.length} 层</span>
          </div>
          <div className="layer-stack">
            {doc.nodes.map((node, index) => (
              <div
                className={`layer-row ${selectedId === node.id ? 'selected' : ''} ${node.enabled ? '' : 'muted-layer'}`}
                key={node.id}
              >
                <Switch
                  size="sm"
                  aria-label={`${node.enabled ? '停用' : '启用'}第 ${index + 1} 层 ${FILTERS[node.type].name}`}
                  checked={node.enabled}
                  onCheckedChange={(checked) =>
                    edit(
                      (document) => ({
                        ...document,
                        nodes: document.nodes.map((n) =>
                          n.id === node.id ? { ...n, enabled: checked } : n,
                        ),
                      }),
                      `${checked ? '启用' : '停用'} ${FILTERS[node.type].name}`,
                    )
                  }
                />
                <button
                  className="layer-select"
                  onClick={() => {
                    finish();
                    setSelectedId(node.id);
                  }}
                >
                  <span className="layer-index">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span>{FILTERS[node.type].name}</span>
                </button>
                <span className="layer-tools">
                  <button
                    title="上移"
                    aria-label={`上移第 ${index + 1} 层`}
                    disabled={!index}
                    onClick={() =>
                      edit((d) => moveNode(d, node.id, -1), '上移图层')
                    }
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    title="下移"
                    aria-label={`下移第 ${index + 1} 层`}
                    disabled={index === doc.nodes.length - 1}
                    onClick={() =>
                      edit((d) => moveNode(d, node.id, 1), '下移图层')
                    }
                  >
                    <ArrowDown size={13} />
                  </button>
                </span>
              </div>
            ))}
            {!doc.nodes.length && (
              <div className="empty-stack">
                <Layers size={23} />
                <p>
                  还没有效果层
                  <br />
                  从左侧添加滤镜或文字
                </p>
              </div>
            )}
          </div>
          {selected && definition ? (
            <div className="inspector" key={selected.id}>
              <div className="inspector-heading">
                <div>
                  <span className="eyebrow">03 / 调整当前层</span>
                  <h2>{definition.name}</h2>
                </div>
                <div className="inspector-actions">
                  <button
                    className="icon-button"
                    title="恢复这一层的默认参数"
                    aria-label="重置当前层"
                    onClick={() =>
                      changeNode(
                        selected.id,
                        {
                          ...definition.defaults,
                          opacity: 100,
                          ...(selected.type === 'sticker'
                            ? { assetId: selected.params.assetId }
                            : {}),
                        },
                        '重置当前层',
                      )
                    }
                  >
                    <RotateCcw size={14} />
                  </button>
                  <button
                    className="icon-button"
                    title="复制图层"
                    aria-label="复制图层"
                    onClick={() => {
                      const clone = {
                        ...selected,
                        id: newId(),
                        params: { ...selected.params },
                      };
                      edit(
                        (d) => ({
                          ...d,
                          nodes: d.nodes.flatMap((n) =>
                            n.id === selected.id ? [n, clone] : [n],
                          ),
                        }),
                        '复制图层',
                      );
                      setSelectedId(clone.id);
                    }}
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    className="icon-button"
                    title="删除图层"
                    aria-label="删除图层"
                    onClick={() => {
                      const index = doc.nodes.findIndex(
                        (n) => n.id === selected.id,
                      );
                      edit(
                        (d) => ({
                          ...d,
                          nodes: d.nodes.filter((n) => n.id !== selected.id),
                        }),
                        '删除图层',
                      );
                      setSelectedId(
                        doc.nodes[index - 1]?.id ??
                          doc.nodes[index + 1]?.id ??
                          '',
                      );
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <Control
                field={{
                  key: 'opacity',
                  label: ['text', 'sticker'].includes(selected.type)
                    ? '图层不透明度'
                    : '效果强度',
                  kind: 'number',
                  min: 0,
                  max: 100,
                  unit: '%',
                }}
                value={selected.params.opacity}
                onChange={(value, draft) =>
                  changeNode(
                    selected.id,
                    { opacity: value },
                    '调整图层强度',
                    draft,
                    'opacity',
                  )
                }
                onCommit={finish}
              />
              {selected.type === 'dither' && (
                <div className="palette-actions">
                  <button
                    onClick={() =>
                      changeNode(
                        selected.id,
                        {
                          ...paletteFromPrimary(String(selected.params.color)),
                          autoPalette: true,
                        },
                        '从主色生成配色',
                      )
                    }
                  >
                    主色自动配色
                  </button>
                  <button onClick={() => void getSourceColors()}>
                    读取原图色调
                  </button>
                  <button
                    onClick={() =>
                      changeNode(selected.id, { ...DITHER }, '恢复参考紫黑')
                    }
                  >
                    参考紫黑
                  </button>
                  <button
                    onClick={() =>
                      changeNode(
                        selected.id,
                        { fade: 0, texture: 100 },
                        '纯网点无渐暗',
                      )
                    }
                  >
                    纯网点 · 无渐暗
                  </button>
                </div>
              )}
              {['sticker', 'wanted'].includes(selected.type) && (
                <div className="layer-asset">
                  {assets.current.get(String(selected.params.assetId)) && (
                    <img
                      alt="当前图层图片"
                      src={
                        assets.current.get(String(selected.params.assetId))!.url
                      }
                    />
                  )}
                  <button
                    className="quiet-button"
                    disabled={loading}
                    onClick={() => {
                      photoTarget.current = selected.id;
                      photoRef.current?.click();
                    }}
                  >
                    <ImagePlus size={15} />
                    {selected.type === 'wanted' ? '选择海报左图' : '更换贴图'}
                  </button>
                  {selected.type === 'wanted' && (
                    <small>不选择时，左右栏使用当前作品的不同裁切。</small>
                  )}
                </div>
              )}
              {selected.type === 'music' && (
                <p className="helper">
                  液态玻璃会折射卡片后的真实图像，高光与色散一起导出。降低背景模糊可更清楚地看到折射；也可切换经典磨砂材质。
                </p>
              )}
              {definition.fields
                .filter(
                  (field) =>
                    selected.type !== 'music' ||
                    selected.params.material !== 'classic' ||
                    ![
                      'refraction',
                      'thickness',
                      'dispersion',
                      'highlight',
                      'light',
                    ].includes(field.key),
                )
                .map((field) => (
                  <Control
                    key={field.key}
                    field={field}
                    value={selected.params[field.key]}
                    onChange={(value, draft) =>
                      parameter(selected, field, value, draft)
                    }
                    onCommit={finish}
                  />
                ))}
              {['text', 'sticker'].includes(selected.type) && (
                <p className="helper">
                  位置和大小相对于这一层所在的画布。放在滤镜后面可保持图层本来的颜色。
                </p>
              )}
            </div>
          ) : (
            <div className="inspector-placeholder">
              选择一个效果层
              <br />
              在这里调整参数
            </div>
          )}
        </aside>
      </div>
      <footer className="history-bar">
        <div className="history-navigation">
          <div>
            <button
              className="icon-button"
              aria-label="撤销"
              title="撤销 Ctrl/⌘ Z"
              disabled={history.cursor === 0 && !history.draft}
              onClick={() => navigate('undo')}
            >
              <Undo2 size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="重做"
              title="重做 Ctrl/⌘ Shift Z"
              disabled={
                history.cursor >= history.entries.length - 1 ||
                Boolean(history.draft)
              }
              onClick={() => navigate('redo')}
            >
              <Redo2 size={17} />
            </button>
          </div>
          <small>
            历史步骤 {history.cursor + 1} / {history.entries.length}
          </small>
        </div>
        <nav
          ref={historyTrack}
          className="history-track"
          aria-label="操作历史，不设步数上限"
        >
          {history.entries.map((entry, index) => (
            <button
              key={index}
              aria-current={index === history.cursor ? 'step' : undefined}
              className={`history-step ${index === history.cursor ? 'current' : ''} ${index > history.cursor ? 'future' : ''}`}
              onClick={() => navigate(index)}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              {entry.label}
            </button>
          ))}
          {history.draft && <span className="history-draft">正在调整…</span>}
        </nav>
      </footer>
      {dropActive && (
        <div className="drop-overlay">
          <ImagePlus size={40} />
          <strong>松开以更换原图</strong>
          <span>添加贴图请使用「基础 → 贴图图层」</span>
        </div>
      )}
      {error && (
        <div className="toast error" role="alert">
          <span>{error}</span>
          <button aria-label="关闭错误提示" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
    </main>
  );
}
