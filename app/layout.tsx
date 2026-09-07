import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '网点暗房 · Dither Studio',
  description: '将图片转换为紫黑有序网点背景。实时调节网点、暗部细节与渐暗，原尺寸导出 PNG。图像处理在本机完成。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <body>
        {children}
      </body>
    </html>
  );
}
