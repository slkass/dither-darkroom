import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '暗房 · Darkroom Image Lab',
  description:
    '在浏览器中叠加 Dither、漂白剂、CCD、黑白版画与 Bloom。编辑画布、贴图和文字，制作海报与专辑卡片，按步骤撤销并导出 PNG。图片仅在本机处理。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <body>{children}</body>
    </html>
  );
}
