---
Task ID: 2
Agent: Main Agent
Task: 在原项目基础上添加图片合成视频功能，保留所有原有功能

Work Log:
- 分析原项目完整代码（2456行 App.tsx + 5个服务 + 4个组件）
- 安装原项目所需依赖：@google/genai, jszip, react-image-crop, browser-image-compression
- 复制原项目所有 services 和 components 到 Next.js 项目
- 创建视频转场效果模块 transitions.ts（12种效果）
- 创建视频生成服务 videoService.ts（Canvas + MediaRecorder API）
- 创建视频类型定义 types.ts
- 创建视频合成器 UI 组件 VideoComposer.tsx
- 创建主页面 page.tsx，包含：
  - 标签页导航：图片处理 / 视频合成
  - 图片处理标签页：完整保留原项目所有功能
  - 视频合成标签页：VideoComposer 组件
- Lint 检查通过，开发服务器运行正常

Stage Summary:
- 原项目所有功能完整保留：AI去字、Logo水印、裁剪、切片、文件夹上传、ZIP下载、状态持久化
- 新增视频合成功能：12种转场效果、6种视频比例、自定义参数
- 标签页切换界面，两个功能模块独立运行互不干扰
