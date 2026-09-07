# 网点暗房 · Dither Studio

把图片转换成紫黑色的有序网点背景。保留连续明暗，再叠加规则方形网点和向下渐暗效果。

## 功能

- 上传、拖拽或粘贴图片，默认提供一张示例人像。
- 三种预设：参考紫黑、保留细节、纯网点。
- 调节网点大小、覆盖率、强度、暗部细节、配色、亮度、对比度与渐暗。
- 查看原图、滑动对比和放大预览。
- 导出原图尺寸或长边不超过 2048 / 1200 px 的 PNG；网点按尺寸等比缩放。
- 图像处理在浏览器的 Web Worker 中完成，不上传用户选择的图片。

## 本地运行

需要 Node.js 22.13 或更新版本，以及 npm。

```sh
git clone https://github.com/kamiilbardaq/dither-darkroom.git
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
- GIF 按第一帧静态画面处理；透明区域以白色合成。
- 单个文件最大 32 MB，总像素不超过 3200 万，单边不超过 16384 px。
- 建议使用支持 Web Worker、OffscreenCanvas 和 createImageBitmap 的现代浏览器。
- 实时预览最长边为 1800 px；导出会根据所选尺寸重新处理原图，不会把预览简单放大。

## 实现

主要使用 React、TypeScript、Vinext、Vite 和 shadcn / Base UI。

| 文件 | 用途 |
| --- | --- |
| `app/page.tsx` | 图片导入、控件、预览、对比与导出 |
| `app/globals.css` | 桌面和移动端界面 |
| `public/processor.js` | 本地图像处理 Worker |
| `public/sample.jpg` | 默认示例图片，可替换为自己的图片 |
| `vite.config.ts` | 开发与构建配置 |

处理流程：亮度计算 → 暗部提升与局部细节增强 → 4×4 Bayer 有序网点 → 连续双色明暗混合 → 独立渐暗层。网点并不是简单的像素化或随机噪点滤镜。

在支持 `document.modelContext` 的浏览器中，页面还会提供读取当前设置与应用预设的 WebMCP 工具；不支持时不影响常规使用。
