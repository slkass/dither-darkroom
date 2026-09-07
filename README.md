# 暗房 · Darkroom Image Lab

在浏览器本地叠加滤镜、编辑文字和贴图，制作网点背景、印刷海报与专辑卡片。

## 功能

- **色彩**：从一个主色自动生成中间色和暗部色，也可提取原图配色或保留原图色彩。
- **Dither**：参考十字层次、方点抖色、十字、交叉、圆点、方块、菱形、平行线；大小、间距、旋转、笔画、渐暗、暗角和颗粒可调。
- **Bleach Bypass 风格近似**：漂白剂、1/4″、CCD。1/4″ 是低清摄像头方向，带蓝色光晕、彩噪和 JPEG 压缩；CCD 提供紫色高光、反光与数码颗粒。为独立 Canvas 实现，没有使用原应用的代码、LUT 或纹理，不保证与其预设完全一致。
- **风格滤镜**：黑白版画、Bloom、旧纸印刷。
- **构图**：可编辑标题、双栏图片和印章的通缉海报；可编辑歌曲名、艺术家、玻璃深度与进度的 iOS 风格专辑卡片。音乐控件是静态图片装饰。
- **基础编辑**：曝光、对比、饱和度、色温、清晰度；常用或自定义画布比例，支持完整留边、拉伸填满和裁切。默认调整效果完成后的最终作品，也可切换到效果开始前的原图构图；透明贴图和多行文字的位置、缩放、旋转、描边与透明度。
- **顺序叠加**：每层可启用、停用、复制、调整强度，通过左侧手柄拖拽排序或用上下按钮移动；行内直接删除，提示条提供撤销，之后仍可用历史恢复。文字、贴图也参与顺序处理，海报可继续套入音乐卡片。
- **预设交换**：导入/导出 JSON，包含效果顺序、全部参数、原图构图、最终画布与贴图素材，不携带原图和历史。导入替换效果并保留当前原图，可整步撤销。最多 256 层、24 张贴图，贴图合计 48 MiB / 4800 万像素，预设文件不超过 64 MiB。先校验与解码，全部成功才应用；导入期间编辑作品会取消本次导入。
- **历史**：不设固定步数上限；每次滑杆操作合并成一步，可撤销、重做或直接跳到任意步骤。撤销后新编辑会替换后续分支。Ctrl/⌘ Z 撤销，Ctrl/⌘ Shift Z 或 Ctrl Y 重做。
- **预览与导出**：默认滑动对比，也可切换原图、效果预览或放大；原图长边或 2048 / 1200 px PNG。导出捕获点击时的完整作品，继续编辑不会改变正在导出的内容。
- **本机处理**：不上传选择的图片。历史和图片保留于当前页面会话，刷新后清空；大量大图和历史仍受设备内存限制。导出最高 3200 万像素，版式变化时可能等比缩小。

## 本地运行

需要 Node.js 22.13 或更新版本，以及 npm。

```sh
git clone https://github.com/slkass/dither-darkroom.git
cd dither-darkroom
npm ci
npm run dev
```

打开终端打印的本地地址，默认为 `http://localhost:3000/`。

```sh
npm run build
npm start
```

`build` 生成 Cloudflare Workers 兼容的产物；`start` 使用 Wrangler 在本地运行构建结果。公开仓库的 `.openai/hosting.json` 不绑定任何已有的 Sites 项目。

## FNOS / Docker 部署

FNOS 安装并启用 Docker 后，将仓库下载到自己的 Docker 项目目录。在该目录执行：

```sh
docker compose up -d --build
```

浏览器打开 `http://你的FNOS地址:8098`。容器使用 Nginx 提供静态网页，包含健康检查，并随 Docker 自动恢复。镜像构建阶段需要访问 npm 和 Docker Hub。

如需更换端口，在项目目录的 `.env` 文件写入 `DITHER_PORT=8099` 后重新启动。该配置文件已被 Git 忽略。

如网络需要镜像代理，可在同一个 `.env` 文件中设置 `NGINX_IMAGE` 和 `NODE_IMAGE`，指定你使用的完整镜像地址；默认使用 Docker 官方镜像。

也可以在电脑上构建好网页，再把 `dist/static` 和仓库一起复制到 NAS，减少 NAS 的构建负担：

```sh
npm ci
npm run build:static
docker compose -f compose.yaml -f compose.prebuilt.yaml up -d --build
```

这个方式只需要 NAS 拉取 Nginx 镜像。更新时重新构建并复制 `dist/static`，再运行相同的 Compose 命令。

```sh
docker compose ps
docker compose logs --tail=50
docker compose down
```

如配置反向代理，请把完整域名根路径指向该端口；目前资源使用根路径，不支持直接放到 `/dither/` 一类的子目录。

## 图片支持

- JPG、PNG、WebP、AVIF、GIF、BMP，实际解码能力取决于浏览器。
- GIF 按第一帧静态画面处理；原图透明区域使用画布底色，贴图保留透明区域。
- 单个文件最大 32 MB，总像素不超过 3200 万，单边不超过 16384 px。
- 建议使用支持 Web Worker、OffscreenCanvas 和 createImageBitmap 的现代浏览器。
- 实时预览最长边为 1400 px；导出会根据所选尺寸重新处理原图，不会把预览简单放大。

## 实现

主要使用 React、TypeScript、Vinext、Vite 和 shadcn / Base UI。

| 文件 | 用途 |
| --- | --- |
| `app/page.tsx` | 图片导入、控件、预览、对比与导出 |
| `app/globals.css` | 桌面和移动端界面 |
| `public/processor.js` | Dither 网点算法 |
| `public/editor-worker.js` | 资源缓存、顺序处理与导出任务 |
| `public/studio-filters.js` | 叠加滤镜、文字贴图和构图 |
| `lib/history.mjs` | 不设固定步数上限的元数据历史 |
| `lib/presets.mjs` | 可移植预设、参数校验与素材引用 |
| `lib/editor.ts` | 可调参数与滤镜目录 |
| `lib/comparison.mjs` | 对比分界线坐标、键盘和指针捕获处理 |
| `public/sample.jpg` | 默认示例图片，可替换为自己的图片 |
| `vite.config.ts` | 开发与构建配置 |

处理流程：亮度计算 → 暗部提升与局部细节增强 → 四级色调的 4×4 Bayer 有序抖色 → 连续明暗混合 → 独立渐暗层。每个色阶间使用完整的覆盖范围，让小方点逐渐连接成“＋”形，再形成带方孔的色块；不是在图像上重复盖固定的十字图标。旧版方块模式保留供对比。

在支持 `document.modelContext` 的浏览器中，页面还会提供读取编辑器状态与添加滤镜的 WebMCP 工具；不支持时不影响常规使用。

`npm test` 检查网点、对比拖拽、历史分支、配色与原生 Canvas 叠加/编码。原生 Canvas 用于测试，不会打包进网页。

## 液态玻璃来源

iOS 专辑卡片按 809:1771 的手机版面生成，包含灵动岛缩略封面、均衡器、方形封面、歌曲信息、进度、音量、AirPlay 及 All Speakers & TVs 胶囊。可独立关闭灵动岛、模拟桌面、AirPlay 和外部扬声器胶囊；移除了设备文字行。默认使用 Liquid Glass 风格，也可切换经典磨砂材质。支持桌面图标模糊、玻璃着色、折射、厚度、色散、镜面高光和光照方向，文字与控件可自动适配明暗。效果直接进入 PNG，不依赖网页 CSS 截图。它是网页端的静态风格实现，并非 Apple 原生系统组件。

折射核心移植自 [Whynotmetoo/liquid-glass-canvas](https://github.com/Whynotmetoo/liquid-glass-canvas) 0.1.0 的 MIT 声明版本，固定提交 `b14d0b21b67102b5e70ab264d38535ab0f3d44fb`。`public/liquid-glass.js` 将其 shader 数学改为本地 CPU Canvas 渲染，并补充边缘抗锯齿、双线性采样和按图片尺寸缩放。每次复用 128 行的临时缓冲，以减少高清导出的额外内存。来源和许可说明位于 `public/licenses/liquid-glass-canvas.txt`。
