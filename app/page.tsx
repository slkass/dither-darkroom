'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, ChevronDown, Expand, ImagePlus, LoaderCircle, RotateCcw, ScanLine, SlidersHorizontal, X } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { flushSync } from 'react-dom';

type Settings = { pattern: string; cell: number; coverage: number; lift: number; contrast: number; texture: number; fade: number; start: number; brightness: number; color: string; background: string };
const DEFAULTS: Settings = { pattern: 'tonal', cell: 4, coverage: 50, lift: 32, contrast: 105, texture: 90, fade: 92, start: 15, brightness: 100, color: '#8a76e9', background: '#050508' };
const PRESETS = [
  { name: '参考紫黑', caption: '十字层次 · 向下渐暗', values: DEFAULTS, className: 'reference' },
  { name: '保留细节', caption: '细网点 · 提亮暗部', values: { ...DEFAULTS, cell: 3, lift: 45, texture: 72, fade: 50 }, className: 'detail' },
  { name: '纯网点', caption: '清晰颗粒 · 无渐暗', values: { ...DEFAULTS, texture: 100, fade: 0, coverage: 60 }, className: 'pure' },
];
type Source = { name: string; width: number; height: number; url: string };
function Range({ label, value, min = 0, max = 100, unit = '%', onChange }: { label: string; value: number; min?: number; max?: number; unit?: string; onChange: (v: number) => void }) {
  return <div className="range"><div className="range-heading"><label>{label}</label><output>{value}{unit}</output></div><Slider aria-label={label} value={[value]} min={min} max={max} step={1} onValueChange={v => onChange(Array.isArray(v) ? v[0] : v)} /></div>;
}
function Choice({ label, value, onChange, items }: {label:string; value:string; onChange:(v:string)=>void; items: [string,string][]}) {
  return <Select value={value} onValueChange={v => { if(v) onChange(v); }}><SelectTrigger aria-label={label}><SelectValue>{items.find(i => i[0]===value)?.[1]}</SelectValue></SelectTrigger><SelectContent>{items.map(([v,t])=><SelectItem key={v} value={v}>{t}</SelectItem>)}</SelectContent></Select>;
}
export default function Home() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS), [preset, setPreset] = useState('参考紫黑');
  const [source, setSource] = useState<Source | null>(null), [ready,setReady]=useState(false), [working,setWorking]=useState(true), [exporting,setExporting]=useState(false);
  const [error,setError]=useState(''), [notice,setNotice]=useState(''), [view,setView]=useState('effect'), [split,setSplit]=useState(50), [zoom,setZoom]=useState(false), [exportSize,setExportSize]=useState('original'), [dragging,setDragging]=useState(false);
  const workerRef=useRef<Worker|null>(null), canvasRef=useRef<HTMLCanvasElement>(null), fileRef=useRef<HTMLInputElement>(null), sourceRef=useRef<Source|null>(null);
  const settingsRef=useRef(settings), requestRef=useRef(0), loadRef=useRef(0), sourceVersion=useRef(0), exportNameRef=useRef('image');
  settingsRef.current=settings;
  useEffect(()=>{
    type ModelContext = {registerTool:(tool:{name:string;description:string;inputSchema:object;annotations:object;execute:(input:unknown)=>unknown},options:{signal:AbortSignal})=>void|Promise<void>};
    const context=(document as Document & {modelContext?:ModelContext}).modelContext;
    if(!context?.registerTool)return;
    const lifecycle=new AbortController();
    const register=(tool:Parameters<ModelContext['registerTool']>[0])=>{try{void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
    register({name:'get_dither_settings',description:'Read the current image dimensions and visible dither settings. No changes.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:false},execute:()=>({settings:settingsRef.current,image:sourceRef.current?{width:sourceRef.current.width,height:sourceRef.current.height}:null})});
    register({name:'apply_dither_preset',description:'Apply one of the visible dither presets. Updates controls and schedules a local preview; does not export an image.',inputSchema:{type:'object',properties:{preset:{type:'string',enum:PRESETS.map(p=>p.name)}},required:['preset'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:false},execute:(input:unknown)=>{
      if(!input||typeof input!=='object'||Object.keys(input).some(k=>k!=='preset'))throw new Error('Expected only a preset name.');
      const p=PRESETS.find(p=>p.name===(input as {preset?:unknown}).preset);if(!p)throw new Error('Unknown preset.');
      flushSync(()=>{setSettings({...p.values});setPreset(p.name);});return {preset:p.name,settings:{...p.values},preview:'updating'};
    }});
    return()=>lifecycle.abort();
  },[]);
  const load=useCallback(async(file?:File)=>{
    const ticket=++loadRef.current; setError('');setWorking(true);let url='';
    try {
      if(file && file.size>32*1024*1024) throw new Error('图片超过 32 MB，请先压缩后重试。');
      if(file && !['image/jpeg','image/png','image/webp','image/avif','image/gif','image/bmp'].includes(file.type)) throw new Error('请使用 JPG、PNG、WebP、AVIF、GIF 或 BMP 图片。');
      const response=file?null:await fetch('/sample.jpg');
      if(response&&!response.ok) throw new Error('示例图片加载失败，你仍然可以上传自己的图片。');
      const blob=file??await response!.blob(), bitmap=await createImageBitmap(blob,{imageOrientation:'from-image'});
      if(ticket!==loadRef.current){bitmap.close();return;}
      if(bitmap.width*bitmap.height>32_000_000||Math.max(bitmap.width,bitmap.height)>16384){bitmap.close();throw new Error('请使用不超过 3200 万像素、单边不超过 16384 px 的图片。');}
      url=URL.createObjectURL(blob);const next={name:file?.name??'示例人像.jpg',width:bitmap.width,height:bitmap.height,url},old=sourceRef.current;
      sourceRef.current=next;setSource(next);setReady(false);sourceVersion.current++;requestRef.current++;
      workerRef.current?.postMessage({type:'load',bitmap,sourceVersion:sourceVersion.current},[bitmap]);
      if(old) URL.revokeObjectURL(old.url);if(file?.type==='image/gif')setNotice('GIF 将处理第一帧静态画面。');
    }catch(e){if(ticket!==loadRef.current)return;if(url)URL.revokeObjectURL(url);setWorking(false);setError(e instanceof Error?e.message:'无法读取图片，请换一张重试。');}
  },[]);
  useEffect(()=>{
    const worker=new Worker('/processor.js?v=2');workerRef.current=worker;
    worker.onmessage=event=>{const m=event.data;
      if(m.type==='loaded'&&m.sourceVersion===sourceVersion.current)setReady(true);
      if(m.type==='preview'){
        if(m.id!==requestRef.current||m.sourceVersion!==sourceVersion.current){m.bitmap.close();return;}
        const canvas=canvasRef.current;if(canvas){canvas.width=m.width;canvas.height=m.height;canvas.getContext('2d')!.drawImage(m.bitmap,0,0);}m.bitmap.close();setWorking(false);
      }
      if(m.type==='export'){const url=URL.createObjectURL(m.blob),a=document.createElement('a');a.href=url;a.download=`${exportNameRef.current}-dither.png`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);setExporting(false);setNotice(`PNG 已生成 · ${m.width} × ${m.height}`);}
      if(m.type==='error'){setError(m.message);setWorking(false);setExporting(false);}
    };
    worker.onerror=()=>{setError('图像处理未能启动，请刷新网页后重试。');setWorking(false);setExporting(false);};
    void load();return()=>{worker.terminate();workerRef.current=null;loadRef.current++;if(sourceRef.current)URL.revokeObjectURL(sourceRef.current.url);};
  },[load]);
  useEffect(()=>{if(!ready)return;setWorking(true);const id=++requestRef.current,timer=setTimeout(()=>workerRef.current?.postMessage({type:'preview',id,sourceVersion:sourceVersion.current,settings,maxSize:1800}),70);return()=>clearTimeout(timer);},[settings,ready]);
  useEffect(()=>{if(notice){const timer=setTimeout(()=>setNotice(''),4500);return()=>clearTimeout(timer);}},[notice]);
  useEffect(()=>{const paste=(e:ClipboardEvent)=>{const f=Array.from(e.clipboardData?.files??[]).find(f=>f.type.startsWith('image/'));if(f){e.preventDefault();void load(f);}};window.addEventListener('paste',paste);return()=>window.removeEventListener('paste',paste);},[load]);
  const update=(key:keyof Settings,value:number|string)=>{setSettings(s=>({...s,[key]:value}));setPreset('自定义');};
  const exportImage=()=>{if(!ready||exporting)return;setExporting(true);setError('');exportNameRef.current=sourceRef.current?.name.replace(/\.[^.]+$/,'')??'image';workerRef.current?.postMessage({type:'export',settings:settingsRef.current,maxSize:exportSize==='original'?0:Number(exportSize)});};
  return <main onDragOver={e=>{e.preventDefault();if(e.dataTransfer.types.includes('Files'))setDragging(true);}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))setDragging(false);}} onDrop={e=>{e.preventDefault();setDragging(false);if(e.dataTransfer.files[0])void load(e.dataTransfer.files[0]);}}>
    <header className="topbar"><a className="brand" href="/" aria-label="网点暗房首页"><span className="brand-mark" aria-hidden="true"/><span>网点暗房<span className="brand-en">DITHER STUDIO</span></span></a><div className="top-actions"><span className="local-badge"><span/>图片仅在本机处理</span><button className="primary-button" onClick={exportImage} disabled={!ready||exporting}>{exporting?<LoaderCircle className="spin" size={17}/>:<ArrowDownToLine size={17}/>}<span>{exporting?'正在导出':'导出 PNG'}</span></button></div></header>
    <div className="workspace"><aside className="settings-panel"><div className="panel-title"><h1>把明暗，变成网点。</h1><p>紫黑色调 · 有序抖色 · 氛围渐暗</p></div>
      <input ref={fileRef} type="file" className="sr-only" accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp" onChange={e=>{if(e.target.files?.[0])void load(e.target.files[0]);e.target.value='';}}/>
      <button className="upload-zone" disabled={exporting} onClick={()=>fileRef.current?.click()}><ImagePlus size={23}/><span>选择图片 <span className="upload-hint">或拖到这里</span></span><small>JPG / PNG / WebP 等 · 支持粘贴</small></button>
      <section className="control-section"><div className="section-heading"><h2>01 <span>选择起点</span></h2><span className="metadata">{preset==='自定义'?'已调整':'预设'}</span></div><div className="preset-list">{PRESETS.map(p=><button key={p.name} className={`preset ${preset===p.name?'selected':''}`} onClick={()=>{setSettings({...p.values});setPreset(p.name);}}><span className={`preset-swatch ${p.className}`} aria-hidden="true"/><span><strong>{p.name}</strong><small>{p.caption}</small></span>{preset===p.name&&<Check size={16}/>}</button>)}</div></section>
      <section className="control-section"><div className="section-heading"><h2>02 <span>网点与层次</span></h2><SlidersHorizontal size={14}/></div><div className="pattern-control"><label>网点结构</label><Choice label="网点结构" value={settings.pattern} onChange={v=>update('pattern',v)} items={[["tonal","十字层次（参考）"],["bayer","方块网点（旧版）"]]}/><p>随明暗形成方点、十字与方孔</p></div><Range label="网点大小" value={settings.cell} min={1} max={8} unit="" onChange={v=>update('cell',v)}/><Range label="网点覆盖" value={settings.coverage} min={20} max={85} onChange={v=>update('coverage',v)}/><Range label="网点强度" value={settings.texture} onChange={v=>update('texture',v)}/><Range label="暗部细节" value={settings.lift} max={65} onChange={v=>update('lift',v)}/></section>
      <section className="control-section"><div className="section-heading"><h2>03 <span>色彩与氛围</span></h2></div><div className="color-row">{([['color','网点色'],['background','暗部色']] as const).map(([k,t])=><label className="color-control" key={k}><input type="color" value={settings[k]} onChange={e=>update(k,e.target.value)} aria-label={t}/><span>{t}<small>{settings[k].toUpperCase()}</small></span></label>)}</div><Range label="向下渐暗" value={settings.fade} onChange={v=>update('fade',v)}/><Range label="渐暗起点" value={settings.start} max={80} onChange={v=>update('start',v)}/><details className="advanced"><summary>更多明暗设置<ChevronDown size={15}/></summary><Range label="整体亮度" value={settings.brightness} min={50} max={160} onChange={v=>update('brightness',v)}/><Range label="对比度" value={settings.contrast} min={60} max={160} onChange={v=>update('contrast',v)}/></details></section><button className="reset-button" onClick={()=>{setSettings({...DEFAULTS});setPreset('参考紫黑');}}><RotateCcw size={14}/>恢复参考效果</button>
    </aside><section className="preview-panel" aria-label="图片工作区"><div className="preview-toolbar"><div className="file-meta"><ScanLine size={16}/><span title={source?.name}>{source?.name??'载入图片中'}</span><span className="dimensions">{source?`${source.width} × ${source.height}`:''}</span></div><div className="view-tools"><Choice label="预览模式" value={view} onChange={setView} items={[["effect","效果预览"],["original","查看原图"],["compare","滑动对比"]]}/><button className={`icon-button ${zoom?'active':''}`} aria-label={zoom?'适应画布':'放大查看网点'} title={zoom?'适应画布':'放大查看网点'} onClick={()=>setZoom(z=>!z)}><Expand size={17}/></button></div></div>
      <div className={`preview-stage ${zoom?'zoomed':''}`}><div className="stage-corner top-left"/><div className="stage-corner bottom-right"/><div className="image-frame" style={{aspectRatio:source?`${source.width}/${source.height}`:'1.13','--ratio':source?source.width/source.height:1.13} as React.CSSProperties}><canvas ref={canvasRef} className="result-canvas" aria-label="处理后的紫黑网点图片"/>{source&&view!=='effect'&&<img className="original-image" src={source.url} alt="导入的原始图片" style={{clipPath:view==='compare'?`inset(0 ${100-split}% 0 0)`:undefined}}/>}{view==='compare'&&<><div className="compare-line" style={{left:`${split}%`}}><span>‹ ›</span></div><span className="image-label original-label">原图</span><span className="image-label effect-label">效果</span></>}{!source&&<div className="image-loading"><LoaderCircle className="spin" size={24}/><span>正在准备示例图片</span></div>}</div></div>
      {view==='compare'&&<div className="compare-control"><span>原图</span><Slider aria-label="原图与效果对比分界线" min={0} max={100} value={[split]} onValueChange={v=>setSplit(Array.isArray(v)?v[0]:v)}/><span>效果</span></div>}
      <div className="preview-footer"><span className="render-status" role="status"><span className={working?'busy-dot':''}/>{working?'正在处理':zoom?'放大预览 · 可滚动查看':'实时预览'}<span className="preview-resolution"> / 网点随导出尺寸等比缩放</span></span><div className="export-size"><span>导出尺寸</span><Choice label="导出尺寸" value={exportSize} onChange={setExportSize} items={[["original","原图尺寸"],["2048","长边 2048 px"],["1200","长边 1200 px"]]}/></div></div><div className="workspace-note"><span>有序网点，连续明暗。</span><button onClick={()=>void load()} disabled={exporting}>使用示例图片 ↗</button></div>
    </section></div>
    {dragging&&<div className="drop-overlay"><ImagePlus size={42}/><strong>松开，开始转换</strong><span>图片仅在你的浏览器中处理</span></div>}{error&&<div className="toast error" role="alert"><span>{error}</span><button aria-label="关闭错误提示" onClick={()=>setError('')}><X size={16}/></button></div>}{notice&&<div className="toast" role="status"><Check size={16}/>{notice}</div>}
  </main>;
}
