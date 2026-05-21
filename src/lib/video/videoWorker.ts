/**
 * 视频生成 Web Worker
 *
 * 在独立线程中运行视频渲染和编码，不阻塞主线程 UI。
 * 使用 OffscreenCanvas 渲染 + VideoEncoder 编码 + mp4-muxer 封装为 MP4。
 *
 * 通信协议：
 *   主线程 → Worker: { type: 'start', taskId, images, settings }
 *   Worker → 主线程: { type: 'progress', taskId, progress }
 *   Worker → 主线程: { type: 'complete', taskId, buffer }
 *   Worker → 主线程: { type: 'error', taskId, message }
 *   主线程 → Worker: { type: 'abort', taskId }
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

// ---- 类型定义 (与 types.ts 保持一致) ----

type VideoAspectRatio = '16:9' | '9:16' | '4:3' | '1:1' | '3:4' | 'custom';
type TransitionTypeName = 'fade' | 'slideLeft' | 'slideRight' | 'slideUp' | 'slideDown' | 'circleZoom' | 'dissolve' | 'granular' | 'blindsH' | 'blindsV' | 'coverLeft' | 'coverRight';

interface VideoSettings {
  aspectRatio: VideoAspectRatio;
  customWidth?: number;
  customHeight?: number;
  fps: number;
  imageDuration: number;
  transitionDuration: number;
  transition: TransitionTypeName;
  quality: number;
}

interface VideoProgress {
  phase: 'preparing' | 'rendering' | 'encoding';
  current: number;
  total: number;
  percent: number;
}

// ---- 常量 ----

const ASPECT_RATIO_RESOLUTIONS: Record<Exclude<VideoAspectRatio, 'custom'>, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '4:3': { width: 1440, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '3:4': { width: 1080, height: 1440 },
};

function getAspectRatioResolution(
  ratio: VideoAspectRatio,
  customWidth?: number,
  customHeight?: number
): { width: number; height: number } {
  if (ratio === 'custom') {
    return { width: customWidth ?? 1920, height: customHeight ?? 1080 };
  }
  return ASPECT_RATIO_RESOLUTIONS[ratio];
}

// ---- 转场效果 (完整复制，因为 Worker 无法共享模块) ----

type TransitionRenderer = (
  ctx: OffscreenCanvasRenderingContext2D,
  fromImg: ImageBitmap,
  toImg: ImageBitmap,
  progress: number,
  width: number,
  height: number
) => void;

function drawImageCover(
  ctx: OffscreenCanvasRenderingContext2D,
  img: ImageBitmap,
  width: number,
  height: number
): void {
  if (!img.width || !img.height) return;
  const imgRatio = img.width / img.height;
  const canvasRatio = width / height;
  let drawWidth: number, drawHeight: number, cropX: number, cropY: number;
  if (imgRatio > canvasRatio) {
    drawHeight = img.height;
    drawWidth = img.height * canvasRatio;
    cropX = (img.width - drawWidth) / 2;
    cropY = 0;
  } else {
    drawWidth = img.width;
    drawHeight = img.width / canvasRatio;
    cropX = 0;
    cropY = (img.height - drawHeight) / 2;
  }
  ctx.drawImage(img, cropX, cropY, drawWidth, drawHeight, 0, 0, width, height);
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// 转场效果实现
const fade: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  ctx.globalAlpha = 1 - progress;
  drawImageCover(ctx, fromImg, width, height);
  ctx.globalAlpha = progress;
  drawImageCover(ctx, toImg, width, height);
  ctx.globalAlpha = 1;
};

const slideLeft: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  ctx.save(); ctx.translate(-progress * width, 0); drawImageCover(ctx, fromImg, width, height); ctx.restore();
  ctx.save(); ctx.translate((1 - progress) * width, 0); drawImageCover(ctx, toImg, width, height); ctx.restore();
};

const slideRight: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  ctx.save(); ctx.translate(progress * width, 0); drawImageCover(ctx, fromImg, width, height); ctx.restore();
  ctx.save(); ctx.translate(-(1 - progress) * width, 0); drawImageCover(ctx, toImg, width, height); ctx.restore();
};

const slideUp: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  ctx.save(); ctx.translate(0, -progress * height); drawImageCover(ctx, fromImg, width, height); ctx.restore();
  ctx.save(); ctx.translate(0, (1 - progress) * height); drawImageCover(ctx, toImg, width, height); ctx.restore();
};

const slideDown: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  ctx.save(); ctx.translate(0, progress * height); drawImageCover(ctx, fromImg, width, height); ctx.restore();
  ctx.save(); ctx.translate(0, -(1 - progress) * height); drawImageCover(ctx, toImg, width, height); ctx.restore();
};

const circleZoom: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  drawImageCover(ctx, fromImg, width, height);
  const easedProgress = easeInOutCubic(progress);
  const maxRadius = Math.sqrt(width * width + height * height) / 2;
  const radius = maxRadius * easedProgress;
  ctx.save();
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
  ctx.clip();
  drawImageCover(ctx, toImg, width, height);
  ctx.restore();
};

const dissolve: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  const blockSize = 12;
  drawImageCover(ctx, toImg, width, height);
  for (let x = 0; x < width; x += blockSize) {
    for (let y = 0; y < height; y += blockSize) {
      const seed = x * 1000 + y + 7;
      if (progress >= seededRandom(seed)) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, blockSize, blockSize);
      ctx.clip();
      drawImageCover(ctx, fromImg, width, height);
      ctx.restore();
    }
  }
};

const granular: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  const grainSize = 6;
  drawImageCover(ctx, toImg, width, height);
  for (let x = 0; x < width; x += grainSize) {
    for (let y = 0; y < height; y += grainSize) {
      const seed = x * 7919 + y * 104729 + 42;
      const threshold = seededRandom(seed);
      const noise = seededRandom(seed + 1) * 0.15;
      const adjustedThreshold = Math.max(0, Math.min(1, threshold + noise - 0.075));
      if (progress >= adjustedThreshold) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, grainSize, grainSize);
      ctx.clip();
      drawImageCover(ctx, fromImg, width, height);
      ctx.restore();
    }
  }
};

const blindsH: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  const stripCount = 10;
  const stripHeight = height / stripCount;
  drawImageCover(ctx, fromImg, width, height);
  for (let i = 0; i < stripCount; i++) {
    const stripY = i * stripHeight;
    const stripCenter = stripY + stripHeight / 2;
    const revealedHeight = stripHeight * progress;
    const revealY = stripCenter - revealedHeight / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, revealY, width, revealedHeight);
    ctx.clip();
    drawImageCover(ctx, toImg, width, height);
    ctx.restore();
  }
};

const blindsV: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  const stripCount = 10;
  const stripWidth = width / stripCount;
  drawImageCover(ctx, fromImg, width, height);
  for (let i = 0; i < stripCount; i++) {
    const stripX = i * stripWidth;
    const stripCenter = stripX + stripWidth / 2;
    const revealedWidth = stripWidth * progress;
    const revealX = stripCenter - revealedWidth / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(revealX, 0, revealedWidth, height);
    ctx.clip();
    drawImageCover(ctx, toImg, width, height);
    ctx.restore();
  }
};

const coverLeft: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  drawImageCover(ctx, fromImg, width, height);
  const revealWidth = width * progress;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, revealWidth, height);
  ctx.clip();
  drawImageCover(ctx, toImg, width, height);
  ctx.restore();
};

const coverRight: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  drawImageCover(ctx, fromImg, width, height);
  const revealWidth = width * progress;
  ctx.save();
  ctx.beginPath();
  ctx.rect(width - revealWidth, 0, revealWidth, height);
  ctx.clip();
  drawImageCover(ctx, toImg, width, height);
  ctx.restore();
};

const TRANSITIONS: Record<TransitionTypeName, TransitionRenderer> = {
  fade, slideLeft, slideRight, slideUp, slideDown, circleZoom,
  dissolve, granular, blindsH, blindsV, coverLeft, coverRight,
};

// ---- 帧布局计算 ----

interface FrameLayout {
  totalFrames: number;
  imageFrames: number;
  transitionFrames: number;
  imageStartFrames: number[];
}

function computeFrameLayout(imageCount: number, settings: VideoSettings): FrameLayout {
  const { fps, imageDuration, transitionDuration } = settings;
  const imageFrames = Math.round(imageDuration * fps);
  const transitionFrames = Math.round(transitionDuration * fps);
  const totalFrames = imageFrames * imageCount + transitionFrames * Math.max(0, imageCount - 1);
  const imageStartFrames: number[] = [];
  for (let i = 0; i < imageCount; i++) {
    imageStartFrames.push(i * (imageFrames + transitionFrames));
  }
  return { totalFrames, imageFrames, transitionFrames, imageStartFrames };
}

// ---- 帧渲染 (OffscreenCanvas 版) ----

function renderFrame(
  ctx: OffscreenCanvasRenderingContext2D,
  images: ImageBitmap[],
  frameIndex: number,
  layout: FrameLayout,
  transitionRenderer: TransitionRenderer,
  width: number,
  height: number
): void {
  ctx.clearRect(0, 0, width, height);

  let currentImageIndex = -1;
  let isInTransition = false;
  let transitionProgress = 0;
  let nextImageIndex = -1;

  for (let i = 0; i < images.length; i++) {
    const startFrame = layout.imageStartFrames[i];
    const endFrame = startFrame + layout.imageFrames + (i < images.length - 1 ? layout.transitionFrames : 0);

    if (frameIndex >= startFrame && frameIndex < endFrame) {
      currentImageIndex = i;
      const transitionStartFrame = startFrame + layout.imageFrames;
      if (i < images.length - 1 && frameIndex >= transitionStartFrame) {
        isInTransition = true;
        nextImageIndex = i + 1;
        transitionProgress = (frameIndex - transitionStartFrame) / layout.transitionFrames;
        transitionProgress = Math.min(1, Math.max(0, transitionProgress));
      }
      break;
    }
  }

  if (currentImageIndex === -1) return;

  if (isInTransition && nextImageIndex !== -1) {
    transitionRenderer(ctx, images[currentImageIndex], images[nextImageIndex], transitionProgress, width, height);
  } else {
    drawImageCover(ctx, images[currentImageIndex], width, height);
  }
}

// ---- Worker 消息处理 ----

let aborted = false;

self.onmessage = async (e: MessageEvent) => {
  const { type, taskId } = e.data;

  if (type === 'abort') {
    aborted = true;
    return;
  }

  if (type === 'start') {
    aborted = false;
    const { images, settings } = e.data as {
      taskId: string;
      images: ImageBitmap[];
      settings: VideoSettings;
    };

    try {
      const blob = await generateVideoInWorker(images, settings, taskId);
      if (!aborted) {
        // 将 Blob 转为 ArrayBuffer 传输
        const buffer = await blob.arrayBuffer();
        self.postMessage({ type: 'complete', taskId, buffer }, [buffer] as any);
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || aborted) return;
      self.postMessage({ type: 'error', taskId, message: err.message || '生成失败' });
    } finally {
      // 清理 ImageBitmap
      images.forEach(img => img.close());
    }
  }
};

// ---- 核心生成逻辑 ----

async function generateVideoInWorker(
  images: ImageBitmap[],
  settings: VideoSettings,
  taskId: string
): Promise<Blob> {
  const { width, height } = getAspectRatioResolution(settings.aspectRatio, settings.customWidth, settings.customHeight);
  const { fps, quality, transition } = settings;

  const layout = computeFrameLayout(images.length, settings);
  const frameDuration = Math.round(1_000_000 / fps); // 微秒

  // 创建 OffscreenCanvas
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;

  // 创建 MP4 Muxer
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width,
      height,
    },
    fastStart: 'in-memory',
  });

  // 计算比特率
  const pixels = width * height;
  const baseBitrate = Math.round(pixels * fps * 0.1);
  const bitrate = Math.round(baseBitrate * (0.5 + quality * 1.5));

  // 检测 H.264 编码支持
  let codecStr = 'avc1.640028'; // High 4.1
  const codecCheck = (self as any).VideoEncoder?.isConfigSupported?.({
    codec: codecStr,
    width,
    height,
    bitrate,
    framerate: fps,
  });
  if (codecCheck) {
    const result = await codecCheck;
    if (!result.supported) {
      // 尝试 Baseline
      codecStr = 'avc1.42E01E';
      const result2 = await (self as any).VideoEncoder.isConfigSupported({
        codec: codecStr,
        width,
        height,
        bitrate,
        framerate: fps,
      });
      if (!result2.supported) {
        throw new Error('浏览器不支持 H.264 编码');
      }
    }
  }

  // 创建 VideoEncoder
  let encoderError: Error | null = null;
  const encoder = new (self as any).VideoEncoder({
    output: (chunk: any, meta: any) => {
      if (!encoderError) {
        muxer.addVideoChunk(chunk, meta);
      }
    },
    error: (e: Error) => {
      encoderError = e;
      console.error('VideoEncoder error:', e);
    },
  });

  encoder.configure({
    codec: codecStr,
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: 'realtime',
  });

  const transitionRenderer = TRANSITIONS[transition];

  const sendProgress = (progress: VideoProgress) => {
    self.postMessage({ type: 'progress', taskId, progress });
  };

  sendProgress({ phase: 'rendering', current: 0, total: layout.totalFrames, percent: 0 });

  // 逐帧渲染 + 编码
  for (let frameIndex = 0; frameIndex < layout.totalFrames; frameIndex++) {
    if (aborted) {
      try { encoder.close(); } catch {}
      throw new DOMException('视频生成已取消', 'AbortError');
    }

    if (encoderError) {
      try { encoder.close(); } catch {}
      throw new Error(`视频编码失败: ${encoderError.message}`);
    }

    // 渲染当前帧
    renderFrame(ctx, images, frameIndex, layout, transitionRenderer, width, height);

    // 创建 VideoFrame 并编码
    const timestamp = frameIndex * frameDuration;
    const frame = new (self as any).VideoFrame(canvas, { timestamp, duration: frameDuration });
    encoder.encode(frame, { keyFrame: frameIndex === 0 || frameIndex % (fps * 2) === 0 });
    frame.close();

    // 更新进度
    const percent = Math.round(((frameIndex + 1) / layout.totalFrames) * 100);
    sendProgress({
      phase: 'rendering',
      current: frameIndex + 1,
      total: layout.totalFrames,
      percent,
    });

    // 每 16 帧让出事件循环
    if (frameIndex % 16 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  sendProgress({ phase: 'encoding', current: layout.totalFrames, total: layout.totalFrames, percent: 100 });

  // 等待编码器完成
  await encoder.flush();
  muxer.finalize();

  const blob = new Blob([target.buffer], { type: 'video/mp4' });
  try { encoder.close(); } catch {}

  return blob;
}
