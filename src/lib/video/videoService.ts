/**
 * 视频生成服务 v3
 *
 * 支持三种编码路径：
 * 1. Web Worker + OffscreenCanvas + VideoEncoder + mp4-muxer（多线程快速路径，输出 MP4）
 * 2. 主线程 VideoEncoder + mp4-muxer（单线程快速路径，输出 MP4）
 * 3. MediaRecorder（兼容路径，Firefox 等不支持 VideoEncoder 的浏览器，输出 WebM）
 *
 * 关键改进（v3）：
 * - 输出格式改为 MP4（H.264 编码）
 * - 使用 Web Worker 多线程渲染，不阻塞主线程
 * - 支持并发处理多个文件夹的视频生成
 */

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { TRANSITIONS, drawImageCover } from './transitions';
import type { VideoAspectRatio, TransitionTypeName, VideoSettings, VideoProgress, BgmTrack } from './types';

// 重新导出类型
export type { VideoAspectRatio, TransitionTypeName, VideoSettings, VideoProgress, BgmTrack };

// ==================== 常量 ====================

/** 宽高比对应的分辨率映射（降低默认分辨率以提升性能） */
const ASPECT_RATIO_RESOLUTIONS: Record<Exclude<VideoAspectRatio, 'custom'>, { width: number; height: number }> = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '4:3': { width: 960, height: 720 },
  '1:1': { width: 720, height: 720 },
  '3:4': { width: 720, height: 960 },
};

/** 转场效果中文标签 */
export const TRANSITION_LABELS: Record<TransitionTypeName, string> = {
  fade: '淡入淡出',
  slideLeft: '向左滑动',
  slideRight: '向右滑动',
  slideUp: '向上滑动',
  slideDown: '向下滑动',
  circleZoom: '圆形缩放',
  dissolve: '溶解',
  granular: '颗粒化',
  blindsH: '水平百叶窗',
  blindsV: '垂直百叶窗',
  coverLeft: '从左覆盖',
  coverRight: '从右覆盖',
};

// ==================== 浏览器能力检测 ====================

/** 检测浏览器是否支持 VideoEncoder API */
const hasVideoEncoder = typeof VideoEncoder !== 'undefined';
const hasVideoFrame = typeof VideoFrame !== 'undefined';
const hasOffscreenCanvas = typeof OffscreenCanvas !== 'undefined';
const hasAudioEncoder = typeof AudioEncoder !== 'undefined';

/** 是否支持快速编码路径（VideoEncoder） */
export const supportsFastEncoding = hasVideoEncoder && hasVideoFrame;

/** 是否支持 Web Worker 多线程编码路径 */
export const supportsWorkerEncoding = hasVideoEncoder && hasVideoFrame && hasOffscreenCanvas && typeof Worker !== 'undefined';

/** 是否支持音频编码（AudioEncoder） */
export const supportsAudioEncoding = hasAudioEncoder;

// ==================== 辅助函数 ====================

/**
 * 根据宽高比获取视频分辨率
 */
export function getAspectRatioResolution(
  ratio: VideoAspectRatio,
  customWidth?: number,
  customHeight?: number
): { width: number; height: number } {
  if (ratio === 'custom') {
    return {
      width: customWidth ?? 1920,
      height: customHeight ?? 1080,
    };
  }
  return ASPECT_RATIO_RESOLUTIONS[ratio];
}

// ==================== Web Worker 管理 ====================

/** Worker 实例缓存池 */
const workerPool: Worker[] = [];
const MAX_WORKERS = Math.min(navigator.hardwareConcurrency || 2, 2);

/**
 * 获取或创建 Worker 实例
 */
function getWorker(): Worker {
  if (workerPool.length > 0) {
    return workerPool.pop()!;
  }
  // 动态创建 Worker，指向 videoWorker.ts
  return new Worker(
    new URL('./videoWorker.ts', import.meta.url),
    { type: 'module' }
  );
}

/**
 * 归还 Worker 实例到缓存池
 */
function releaseWorker(worker: Worker) {
  if (workerPool.length < MAX_WORKERS) {
    workerPool.push(worker);
  } else {
    worker.terminate();
  }
}

/**
 * 使用 Web Worker 生成视频（真正的多线程，不阻塞主线程）
 */
function generateVideoWorker(
  images: HTMLImageElement[],
  settings: VideoSettings,
  onProgress?: (progress: VideoProgress) => void,
  signal?: AbortSignal
): Promise<Blob> {
  return new Promise<Blob>(async (resolve, reject) => {
    const taskId = Math.random().toString(36).substring(2, 11);
    let worker: Worker | null = null;
    let aborted = false;

    const cleanup = () => {
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        releaseWorker(worker);
        worker = null;
      }
    };

    // 监听取消信号
    if (signal) {
      const onAbort = () => {
        aborted = true;
        if (worker) {
          worker.postMessage({ type: 'abort', taskId });
        }
        // 延迟清理，给 worker 时间处理 abort
        setTimeout(() => {
          cleanup();
          reject(new DOMException('视频生成已取消', 'AbortError'));
        }, 100);
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      // 将 HTMLImageElement 转为 ImageBitmap（可跨线程传输）
      const bitmaps: ImageBitmap[] = [];
      for (const img of images) {
        const bitmap = await createImageBitmap(img);
        bitmaps.push(bitmap);
      }

      worker = getWorker();

      worker.onmessage = (e: MessageEvent) => {
        const { type, taskId: msgTaskId } = e.data;
        if (msgTaskId !== taskId) return;

        if (type === 'progress' && onProgress) {
          onProgress(e.data.progress);
        } else if (type === 'complete') {
          const buffer = e.data.buffer as ArrayBuffer;
          const blob = new Blob([buffer], { type: 'video/mp4' });
          cleanup();
          resolve(blob);
        } else if (type === 'error') {
          cleanup();
          reject(new Error(e.data.message));
        }
      };

      worker.onerror = (err) => {
        cleanup();
        reject(new Error(`Worker 错误: ${err.message}`));
      };

      // 发送任务到 Worker（传输 ImageBitmap 所有权）
      worker.postMessage(
        { type: 'start', taskId, images: bitmaps, settings },
        bitmaps as any
      );
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

// ==================== 帧布局计算 ====================

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

// ==================== 帧渲染 ====================

type RenderImage = HTMLImageElement;

/**
 * 渲染单帧到 Canvas 上下文
 */
function renderFrame(
  ctx: CanvasRenderingContext2D,
  images: RenderImage[],
  frameIndex: number,
  layout: FrameLayout,
  transitionRenderer: (ctx: CanvasRenderingContext2D, fromImg: RenderImage, toImg: RenderImage, progress: number, width: number, height: number) => void,
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

// ==================== 快速路径：VideoEncoder + mp4-muxer（主线程） ====================

/**
 * 使用 VideoEncoder + mp4-muxer 快速生成 MP4 视频（主线程回退）
 */
async function generateVideoFast(
  images: RenderImage[],
  settings: VideoSettings,
  onProgress?: (progress: VideoProgress) => void,
  signal?: AbortSignal,
  bgmOptions?: BgmOptions
): Promise<Blob> {
  const { width, height } = getAspectRatioResolution(settings.aspectRatio, settings.customWidth, settings.customHeight);
  const { fps, quality, transition } = settings;

  const layout = computeFrameLayout(images.length, settings);
  const frameDuration = Math.round(1_000_000 / fps); // 微秒
  const videoDurationSec = layout.totalFrames / fps;

  // 预处理背景音乐
  let audioData: { samples: Float32Array[]; sampleRate: number; numberOfChannels: number } | null = null;
  if (bgmOptions?.audioBuffer && hasAudioEncoder) {
    audioData = prepareAudioSamples(bgmOptions.audioBuffer, videoDurationSec, bgmOptions.volume);
  }

  // 创建画布
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // 创建 mp4-muxer（带可选音频轨）
  const target = new ArrayBufferTarget();
  const muxerConfig: any = {
    target,
    video: {
      codec: 'avc',
      width,
      height,
    },
    fastStart: 'in-memory',
  };
  if (audioData) {
    muxerConfig.audio = {
      codec: 'aac',
      numberOfChannels: audioData.numberOfChannels,
      sampleRate: audioData.sampleRate,
    };
  }
  const muxer = new Muxer(muxerConfig);

  // 计算比特率
  const pixels = width * height;
  const baseBitrate = Math.round(pixels * fps * 0.1);
  const bitrate = Math.round(baseBitrate * (0.5 + quality * 1.5));

  // 检测 H.264 编码支持
  let codecStr = 'avc1.640028'; // High 4.1
  try {
    const check = await VideoEncoder.isConfigSupported({
      codec: codecStr, width, height, bitrate, framerate: fps,
    });
    if (!check.supported) {
      codecStr = 'avc1.42E01E'; // Baseline 3.1
      const check2 = await VideoEncoder.isConfigSupported({
        codec: codecStr, width, height, bitrate, framerate: fps,
      });
      if (!check2.supported) {
        throw new Error('浏览器不支持 H.264 编码');
      }
    }
  } catch {
    codecStr = 'avc1.42E01E';
  }

  // 创建 VideoEncoder
  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (!encoderError) {
        muxer.addVideoChunk(chunk, meta as any);
      }
    },
    error: (e) => {
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

  // 创建 AudioEncoder（如果有背景音乐）
  let audioEncoder: AudioEncoder | null = null;
  let audioEncoderError: Error | null = null;
  let selectedAudioCodec: string | null = null;
  if (audioData) {
    // 检测 AAC 编码器支持 — WebCodecs 使用 'mp4a.40.2' 而非 'aac'
    let audioCodec = 'mp4a.40.2'; // AAC-LC
    try {
      const audioSupport = await AudioEncoder.isConfigSupported({
        codec: audioCodec,
        sampleRate: audioData.sampleRate,
        numberOfChannels: audioData.numberOfChannels,
        bitrate: 128000,
      });
      if (audioSupport.supported) {
        selectedAudioCodec = audioCodec;
      } else {
        console.warn('mp4a.40.2 不支持，尝试 mp4a.40.5 (HE-AAC)...');
        audioCodec = 'mp4a.40.5'; // HE-AAC
        const audioSupport2 = await AudioEncoder.isConfigSupported({
          codec: audioCodec,
          sampleRate: audioData.sampleRate,
          numberOfChannels: audioData.numberOfChannels,
          bitrate: 128000,
        });
        if (audioSupport2.supported) {
          selectedAudioCodec = audioCodec;
        } else {
          console.error('浏览器不支持 AAC 音频编码，将跳过背景音乐');
          audioData = null; // 禁用音频
        }
      }
    } catch (e) {
      console.error('AudioEncoder.isConfigSupported 检查失败:', e);
      audioData = null; // 禁用音频
    }
  }

  if (audioData && selectedAudioCodec) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        if (!audioEncoderError) {
          muxer.addAudioChunk(chunk, meta as any);
        }
      },
      error: (e) => {
        audioEncoderError = e;
        console.error('AudioEncoder error:', e);
      },
    });

    try {
      audioEncoder.configure({
        codec: selectedAudioCodec,
        sampleRate: audioData.sampleRate,
        numberOfChannels: audioData.numberOfChannels,
        bitrate: 128000,
      });
    } catch (e: any) {
      console.error('AudioEncoder.configure 失败:', e);
      audioEncoderError = e;
      // 关闭编码器，视频将不带音频
      try { audioEncoder.close(); } catch (_) {}
      audioEncoder = null;
      audioData = null;
    }
  }

  if (audioData && audioEncoder) {
    // 编码音频数据（分块编码，每块 1024 采样）
    const aacFrameSize = 1024;
    const totalAudioFrames = audioData.samples[0].length;
    let audioTimestamp = 0;
    const audioSampleDuration = Math.round(1_000_000 / audioData.sampleRate); // 微秒

    for (let offset = 0; offset < totalAudioFrames; offset += aacFrameSize) {
      const frameCount = Math.min(aacFrameSize, totalAudioFrames - offset);

      // 转换为 Planar Float32 格式（AudioData 要求的格式）
      const planarData = new Float32Array(frameCount * audioData.numberOfChannels);
      for (let ch = 0; ch < audioData.numberOfChannels; ch++) {
        for (let i = 0; i < frameCount; i++) {
          planarData[ch * frameCount + i] = audioData.samples[ch][offset + i];
        }
      }

      try {
        const audioDataChunk = new AudioData({
          format: 'f32-planar',
          sampleRate: audioData.sampleRate,
          numberOfFrames: frameCount,
          numberOfChannels: audioData.numberOfChannels,
          timestamp: audioTimestamp,
          data: planarData,
        });
        audioEncoder.encode(audioDataChunk);
        audioDataChunk.close();
      } catch (e) {
        console.warn('Audio encode chunk failed:', e);
        break; // 如果某个 chunk 编码失败，停止后续音频编码
      }

      // 检查 AudioEncoder 是否出错
      if (audioEncoderError) {
        console.error('音频编码过程中出错，停止音频编码:', audioEncoderError);
        break;
      }

      audioTimestamp += frameCount * audioSampleDuration;
    }
  }

  const transitionRenderer = TRANSITIONS[transition];

  onProgress?.({ phase: 'rendering', current: 0, total: layout.totalFrames, percent: 0 });

  // ── 逐帧渲染 + 编码 ──
  for (let frameIndex = 0; frameIndex < layout.totalFrames; frameIndex++) {
    if (signal?.aborted) {
      encoder.close();
      audioEncoder?.close();
      throw new DOMException('视频生成已取消', 'AbortError');
    }

    if (encoderError) {
      encoder.close();
      audioEncoder?.close();
      throw new Error(`视频编码失败: ${encoderError.message}`);
    }

    // 渲染当前帧
    renderFrame(ctx, images, frameIndex, layout, transitionRenderer, width, height);

    // 创建 VideoFrame 并编码（精确时间戳）
    const timestamp = frameIndex * frameDuration;
    const frame = new VideoFrame(canvas, { timestamp, duration: frameDuration });
    encoder.encode(frame, { keyFrame: frameIndex === 0 || frameIndex % (fps * 2) === 0 });
    frame.close();

    // 更新进度
    onProgress?.({
      phase: 'rendering',
      current: frameIndex + 1,
      total: layout.totalFrames,
      percent: Math.round(((frameIndex + 1) / layout.totalFrames) * 100),
    });

    // 每 4 帧让出事件循环，保持 UI 响应
    if (frameIndex % 4 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  onProgress?.({ phase: 'encoding', current: layout.totalFrames, total: layout.totalFrames, percent: 100 });

  // 等待编码器完成所有帧的编码
  await encoder.flush();
  if (audioEncoder) {
    await audioEncoder.flush();
    audioEncoder.close();
  }
  muxer.finalize();

  const blob = new Blob([target.buffer], { type: 'video/mp4' });
  encoder.close();

  return blob;
}

// ==================== 兼容路径：MediaRecorder ====================

/**
 * 使用 MediaRecorder 生成视频（兼容不支持 VideoEncoder 的浏览器）
 * 注意：此路径输出 WebM 格式，因为 MediaRecorder 仅支持 WebM 容器
 */
async function generateVideoFallback(
  images: RenderImage[],
  settings: VideoSettings,
  onProgress?: (progress: VideoProgress) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const { width, height } = getAspectRatioResolution(settings.aspectRatio, settings.customWidth, settings.customHeight);
  const { fps, quality, transition } = settings;

  const layout = computeFrameLayout(images.length, settings);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const transitionRenderer = TRANSITIONS[transition];

  // 使用 captureStream(0) 手动控制帧捕获
  const stream = canvas.captureStream(0);
  const videoTrack = stream.getVideoTracks()[0];

  const pixels = width * height;
  const baseBitrate = Math.round(pixels * fps * 0.1);
  const bitrate = Math.round(baseBitrate * (0.5 + quality * 1.5));

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: bitrate,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e: BlobEvent) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  onProgress?.({ phase: 'rendering', current: 0, total: layout.totalFrames, percent: 0 });
  recorder.start(1000);

  for (let frameIndex = 0; frameIndex < layout.totalFrames; frameIndex++) {
    if (signal?.aborted) {
      recorder.stop();
      throw new DOMException('视频生成已取消', 'AbortError');
    }

    renderFrame(ctx, images, frameIndex, layout, transitionRenderer, width, height);

    if (videoTrack && 'requestFrame' in videoTrack) {
      (videoTrack as any).requestFrame();
    }

    onProgress?.({
      phase: 'rendering',
      current: frameIndex + 1,
      total: layout.totalFrames,
      percent: Math.round(((frameIndex + 1) / layout.totalFrames) * 100),
    });

    // 最小间隔等待（2ms），比实时等待快 15-50 倍
    await new Promise(r => setTimeout(r, 2));

    // 每 30 帧额外让出事件循环
    if (frameIndex % 30 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  onProgress?.({ phase: 'encoding', current: layout.totalFrames, total: layout.totalFrames, percent: 100 });

  await new Promise(resolve => setTimeout(resolve, 200));

  return new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => {
      if (signal?.aborted) {
        reject(new DOMException('视频生成已取消', 'AbortError'));
        return;
      }
      const blob = new Blob(chunks, { type: mimeType });
      resolve(blob);
    };
    recorder.onerror = (event) => {
      reject(new Error(`视频录制失败: ${(event as ErrorEvent).message || '未知错误'}`));
    };
    recorder.stop();
  });
}

// ==================== 主入口 ====================

/**
 * 从图像序列生成带转场效果的视频（输出 MP4 格式）
 *
 * 自动选择最佳编码路径：
 * 1. Web Worker 多线程路径（Chrome/Edge + OffscreenCanvas）—— 不阻塞主线程，真正的多线程
 * 2. 主线程 VideoEncoder + mp4-muxer 路径 —— 单线程但不需实时等待
 * 3. MediaRecorder 兼容路径（Firefox）—— 输出 WebM 格式
 *
 * @param images - HTMLImageElement 图像数组
 * @param settings - 视频生成设置
 * @param onProgress - 进度回调函数
 * @param signal - 取消信号
 * @returns 生成的视频 Blob（MP4 格式，兼容路径为 WebM）
 */
/** 解码背景音乐为 AudioBuffer
 *  - 内置音乐：从 /music/ 目录加载真实音频文件
 *  - 自定义上传：从 File 对象解码
 *  - 外部 URL：从网络下载并解码
 */
export async function decodeBgmAudio(urlOrFile: string | File, trackFilePath?: string): Promise<AudioBuffer> {
  // 内置音乐 — 从 /music/ 目录加载真实音频文件
  if (typeof urlOrFile === 'string' && urlOrFile.startsWith('builtin:')) {
    if (!trackFilePath) {
      throw new Error('内置音乐缺少文件路径，请确保 manifest.json 中配置了 filePath');
    }

    const fileUrl = `/music/${trackFilePath}`;
    const audioCtx = new AudioContext();
    try {
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`音乐文件加载失败: ${fileUrl} (HTTP ${response.status})`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = await audioCtx.decodeAudioData(arrayBuffer);
      console.log(`从文件加载内置音乐: ${fileUrl}`);
      return buffer;
    } catch (e) {
      console.error(`内置音乐加载失败 (${fileUrl}):`, e);
      throw e;
    } finally {
      await audioCtx.close();
    }
  }

  // 自定义上传的文件
  if (typeof urlOrFile !== 'string') {
    const audioCtx = new AudioContext();
    try {
      const arrayBuffer = await urlOrFile.arrayBuffer();
      return await audioCtx.decodeAudioData(arrayBuffer);
    } finally {
      await audioCtx.close();
    }
  }

  // 外部 URL（兼容旧逻辑，可能因 CORS 不可用）
  const audioCtx = new AudioContext();
  try {
    const response = await fetch(urlOrFile);
    if (!response.ok) throw new Error(`音频下载失败: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    return await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    await audioCtx.close();
  }
}

/** 将 AudioBuffer 调整到指定时长（裁剪或循环），返回 Float32Array[] (每通道) */
function prepareAudioSamples(audioBuffer: AudioBuffer, targetDurationSec: number, volume: number): { samples: Float32Array[]; sampleRate: number; numberOfChannels: number } {
  const { sampleRate, numberOfChannels } = audioBuffer;
  const targetFrames = Math.ceil(targetDurationSec * sampleRate);
  const samples: Float32Array[] = [];

  for (let ch = 0; ch < numberOfChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    const output = new Float32Array(targetFrames);

    if (channelData.length >= targetFrames) {
      // 裁剪：只需复制前 targetFrames 个采样
      for (let i = 0; i < targetFrames; i++) {
        output[i] = channelData[i] * volume;
      }
    } else {
      // 循环：重复音频直到填满目标时长
      for (let i = 0; i < targetFrames; i++) {
        output[i] = channelData[i % channelData.length] * volume;
      }
    }
    samples.push(output);
  }

  return { samples, sampleRate, numberOfChannels };
}

export interface BgmOptions {
  audioBuffer: AudioBuffer;
  volume: number; // 0-1
}

export async function generateVideo(
  images: RenderImage[],
  settings: VideoSettings,
  onProgress?: (progress: VideoProgress) => void,
  signal?: AbortSignal,
  bgmOptions?: BgmOptions
): Promise<Blob> {
  if (images.length === 0) {
    throw new Error('至少需要 1 张图片才能生成视频');
  }

  // 有背景音乐时，使用主线程路径（因为需要 AudioEncoder 同步音频）
  const hasBgm = !!bgmOptions?.audioBuffer;

  // 优先尝试 Web Worker 多线程路径（无 BGM 时）
  if (supportsWorkerEncoding && !hasBgm) {
    try {
      return await generateVideoWorker(images, settings, onProgress, signal);
    } catch (err) {
      console.warn('Web Worker 编码失败，回退到主线程编码:', err);
      // 继续尝试主线程路径
    }
  }

  // 主线程 VideoEncoder 路径（支持 BGM）
  if (supportsFastEncoding) {
    try {
      return await generateVideoFast(images, settings, onProgress, signal, bgmOptions);
    } catch (err: any) {
      // BGM 模式下，如果失败则尝试不带音频重试
      if (hasBgm) {
        console.warn('带音频的视频合成失败，尝试不带音频重新合成:', err);
        try {
          return await generateVideoFast(images, settings, onProgress, signal, undefined);
        } catch (retryErr) {
          throw retryErr; // 不带音频也失败了，抛出错误
        }
      }
      console.warn('VideoEncoder 编码失败，回退到 MediaRecorder:', err);
      // 回退到兼容路径
    }
  }

  // 兼容路径（不支持 BGM）
  return generateVideoFallback(images, settings, onProgress, signal);
}

/**
 * 获取输出视频的 MIME 类型
 */
export function getOutputMimeType(): string {
  return supportsFastEncoding || supportsWorkerEncoding ? 'video/mp4' : 'video/webm';
}

/**
 * 获取输出视频的文件扩展名
 */
export function getOutputExtension(): string {
  return supportsFastEncoding || supportsWorkerEncoding ? 'mp4' : 'webm';
}
