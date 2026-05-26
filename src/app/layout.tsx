import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

export const metadata: Metadata = {
  title: "一合图片处理",
  description: "一合图片处理 - 智能图片视频合成工具，支持水印添加、AI去字、批量裁剪、视频合成等功能",
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <body
        className="antialiased bg-background text-foreground"
        style={{
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial, sans-serif',
        }}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
