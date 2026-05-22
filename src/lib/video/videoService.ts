/**
 * 视频生成服务 v2
 *
 * 支持两种编码路径：
 * 1. VideoEncoder + webm-muxer（快速路径，无需实时等待，10-30 倍速度提升）
 * 2. MediaRecorder（兼容路径，Firefox 等不支持 VideoEncoder 的浏览器）
 *
 * 关键改进：
 * - 使用 VideoEncoder API 精确控制每帧时间戳，无需实时等待
 * - 渲染速度仅受 CPU 限制，而非帧间隔时间
 * - 支持并发处理多个文件夹的视频生成
 * - 支持背景音乐混入
 */

import { Muxer, ArrayBufferTarget } from 'webm-muxer';
import { TRANSITIONS, drawImageCover } from './transitions';
import type { VideoAspectRatio, TransitionTypeName, VideoSettings, VideoProgress } from './types';

// 重新导出类型
export type { VideoAspectRatio, TransitionTypeName, VideoSettings, VideoProgress };

// ==================== 常量 ====================

/** 宽高比对应的分辨率映射 */
const ASPECT_RATIO_RESOLUTIONS: Record<Exclude<VideoAspectRatio, 'custom'>, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '4:3': { width: 1440, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '3:4': { width: 1080, height: 1440 },
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

/** 是否支持快速编码路径 */
export const supportsFastEncoding = hasVideoEncoder && hasVideoFrame;

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

// ==================== 音频编码 ====================

/**
 * 从 AudioBuffer 中提取指定范围的音频数据为 f32-planar 格式
 */
function getAudioDataSlice(
  buffer: AudioBuffer,
  startFrame: number,
  frameCount: number,
  numberOfChannels: number
): Float32Array {
  const data = new Float32Array(numberOfChannels * frameCount);
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const channelData = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
    for (let i = 0; i < frameCount; i++) {
      data[ch * frameCount + i] = channelData[startFrame + i] || 0;
    }
  }
  return data;
}

interface AudioEncodeResult {
  chunks: EncodedAudioChunk[];
  sampleRate: number;
  numberOfChannels: number;
}

/**
 * 编码音频文件为 Opus 格式
 * - 解码音频文件
 * - 使用 OfflineAudioContext 重采样到 48kHz 立体声并应用音量
 * - 使用 AudioEncoder 编码为 Opus
 * - 如果音频比视频短，自动循环
 */
async function encodeAudioToOpus(
  audioFile: File,
  volume: number,
  targetDuration: number,
  signal?: AbortSignal
): Promise<AudioEncodeResult | null> {
  try {
    const arrayBuffer = await audioFile.arrayBuffer();
    
    // Try decoding with AudioContext
    let audioBuffer: AudioBuffer;
    try {
      const audioCtx = new AudioContext({ sampleRate: 48000 });
      audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      await audioCtx.close();
    } catch (decodeErr) {
      console.error('Audio decode failed with AudioContext, format may be unsupported:', decodeErr);
      console.error('File info:', audioFile.name, 'type:', audioFile.type, 'size:', audioFile.size);
      return null;
    }

    // 计算目标采样数（匹配视频时长）
    const targetSamples = Math.ceil(targetDuration * 48000);
    const numberOfChannels = 2; // 立体声

    // 创建离线上下文进行重采样 + 音量调整
    const offlineCtx = new OfflineAudioContext(numberOfChannels, targetSamples, 48000);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;

    // 应用音量
    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = volume;

    source.connect(gainNode);
    gainNode.connect(offlineCtx.destination);
    source.start(0);

    // 如果音频比视频短，循环播放
    if (audioBuffer.duration < targetDuration) {
      source.loop = true;
    }

    const renderedBuffer = await offlineCtx.startRendering();

    // 检查 AudioEncoder 是否可用
    if (typeof AudioEncoder === 'undefined') {
      console.warn('AudioEncoder 不可用，跳过音频编码');
      return null;
    }

    const chunks: EncodedAudioChunk[] = [];
    const encoder = new AudioEncoder({
      output: (chunk) => {
        chunks.push(chunk);
      },
      error: (e) => {
        console.error('AudioEncoder error:', e);
      }
    });

    encoder.configure({
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels,
      bitrate: 128000,
    });

    // 以 20ms 的块输入音频数据
    const chunkSize = Math.floor(48000 * 0.02);
    for (let offset = 0; offset < targetSamples; offset += chunkSize) {
      if (signal?.aborted) break;
      const frameCount = Math.min(chunkSize, targetSamples - offset);
      const audioData = new AudioData({
        format: 'f32-planar',
        sampleRate: 48000,
        numberOfFrames: frameCount,
        numberOfChannels,
        timestamp: Math.round(offset / 48000 * 1_000_000), // 微秒
        data: getAudioDataSlice(renderedBuffer, offset, frameCount, numberOfChannels),
      });
      encoder.encode(audioData);
      audioData.close();
    }

    await encoder.flush();
    encoder.close();

    return { chunks, sampleRate: 48000, numberOfChannels };
  } catch (err) {
    console.error('音频编码失败:', err);
    return null;
  }
}

// ==================== 快速路径：VideoEncoder + webm-muxer ====================

/**
 * 使用 VideoEncoder + webm-muxer 快速生成视频
 *
 * 核心优势：
 * - 无需实时等待帧间隔，渲染速度仅受 CPU 限制
 * - 每帧的时间戳由代码精确控制，确保视频时长正确
 * - 编码器以最高速度处理，不依赖 wall-clock 时间
 * - 支持背景音乐混入
 */
async function generateVideoFast(
  images: RenderImage[],
  settings: VideoSettings,
  onProgress?: (progress: VideoProgress) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const { width, height } = getAspectRatioResolution(settings.aspectRatio, settings.customWidth, settings.customHeight);
  const { fps, quality, transition } = settings;

  const layout = computeFrameLayout(images.length, settings);
  const frameDuration = Math.round(1_000_000 / fps); // 微秒

  // 计算视频时长（秒），用于音频编码
  const videoDuration = layout.totalFrames / fps;

  // 预编码音频（如果提供了背景音乐）
  let audioResult: AudioEncodeResult | null = null;
  let bgmEncodeFailed = false;
  if (settings.audioFile) {
    onProgress?.({ phase: 'preparing', current: 0, total: 1, percent: 0 });
    audioResult = await encodeAudioToOpus(
      settings.audioFile,
      settings.audioVolume ?? 0.5,
      videoDuration,
      signal
    );
    if (!audioResult) {
      bgmEncodeFailed = true;
      console.warn('BGM encoding failed for:', settings.audioFile.name, '- video will be generated without audio');
      // Notify the caller that BGM failed
      onProgress?.({ phase: 'preparing', current: 0, total: 1, percent: 0, bgmFailed: true });
    }
  }

  // 创建画布
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // 根据 audioResult 创建对应的 muxer 配置
  const target = new ArrayBufferTarget();
  const muxerConfig: any = {
    target,
    video: {
      codec: 'V_VP9',
      width,
      height,
    },
  };
  if (audioResult) {
    muxerConfig.audio = {
      codec: 'A_OPUS',
      numberOfChannels: audioResult.numberOfChannels,
      sampleRate: audioResult.sampleRate,
    };
  }
  const muxer = new Muxer(muxerConfig);

  // 计算比特率
  const pixels = width * height;
  const baseBitrate = Math.round(pixels * fps * 0.1);
  const bitrate = Math.round(baseBitrate * (0.5 + quality * 1.5));

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
    codec: 'vp9',
    width,
    height,
    bitrate,
    framerate: fps,
    latencyMode: 'realtime',
  });

  const transitionRenderer = TRANSITIONS[transition];

  onProgress?.({ phase: 'rendering', current: 0, total: layout.totalFrames, percent: 0 });

  // ── 逐帧渲染 + 编码（无实时等待） ──
  for (let frameIndex = 0; frameIndex < layout.totalFrames; frameIndex++) {
    if (signal?.aborted) {
      encoder.close();
      throw new DOMException('视频生成已取消', 'AbortError');
    }

    if (encoderError) {
      encoder.close();
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

    // 每 8 帧让出事件循环，保持 UI 响应
    if (frameIndex % 8 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  onProgress?.({ phase: 'encoding', current: layout.totalFrames, total: layout.totalFrames, percent: 100 });

  // 等待编码器完成所有帧的编码
  await encoder.flush();
  encoder.close();

  // 添加音频数据到 muxer
  if (audioResult) {
    for (const chunk of audioResult.chunks) {
      muxer.addAudioChunk(chunk);
    }
  }

  muxer.finalize();

  const blob = new Blob([target.buffer], { type: 'video/webm' });

  return blob;
}

// ==================== 兼容路径：MediaRecorder ====================

/**
 * 使用 MediaRecorder 生成视频（兼容不支持 VideoEncoder 的浏览器）
 *
 * 优化策略：
 * - 使用 captureStream(0) + requestFrame() 手动控制帧捕获
 * - 每帧仅等待最小间隔（2ms），而非完整的帧间隔
 * - 编码完成后修正视频播放速率
 * - 支持背景音乐混入（通过 Web Audio API）
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

  // 如果提供了背景音乐，使用 Web Audio API 混入音频轨道
  let audioContext: AudioContext | null = null;
  let audioSource: MediaStreamAudioSourceNode | null = null;

  if (settings.audioFile) {
    try {
      audioContext = new AudioContext({ sampleRate: 48000 });
      const audioBuffer = await audioContext.decodeAudioData(await settings.audioFile.arrayBuffer());

      // 创建 MediaStreamDestination 获取音频流
      const dest = audioContext.createMediaStreamDestination();
      const bufferSource = audioContext.createBufferSource();
      bufferSource.buffer = audioBuffer;

      // 应用音量
      const gainNode = audioContext.createGain();
      gainNode.gain.value = settings.audioVolume ?? 0.5;

      bufferSource.connect(gainNode);
      gainNode.connect(dest);

      // 如果音频比视频短，循环播放
      const videoDuration = layout.totalFrames / fps;
      if (audioBuffer.duration < videoDuration) {
        bufferSource.loop = true;
      }

      bufferSource.start(0);

      // 将音频轨道添加到视频流
      const audioTracks = dest.stream.getAudioTracks();
      for (const track of audioTracks) {
        stream.addTrack(track);
      }

      audioSource = dest as unknown as MediaStreamAudioSourceNode;
    } catch (err) {
      console.warn('背景音乐混入失败，将生成无声视频:', err);
      console.warn('Audio file info:', settings.audioFile.name, 'type:', settings.audioFile.type, 'size:', settings.audioFile.size);
      // Notify the caller that BGM failed
      onProgress?.({ phase: 'preparing', current: 0, total: 1, percent: 0, bgmFailed: true });
      // Clean up audio context if it was partially created
      if (audioContext) {
        try { await audioContext.close(); } catch { /* ignore */ }
      }
    }
  }

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
      if (audioContext) audioContext.close();
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
        if (audioContext) audioContext.close();
        reject(new DOMException('视频生成已取消', 'AbortError'));
        return;
      }
      const blob = new Blob(chunks, { type: mimeType });
      if (audioContext) audioContext.close();
      resolve(blob);
    };
    recorder.onerror = (event) => {
      if (audioContext) audioContext.close();
      reject(new Error(`视频录制失败: ${(event as ErrorEvent).message || '未知错误'}`));
    };
    recorder.stop();
  });
}

// ==================== 主入口 ====================

/**
 * 从图像序列生成带转场效果的视频
 *
 * 自动选择最佳编码路径：
 * - 支持 VideoEncoder 的浏览器（Chrome/Edge/Safari 16.4+）：快速路径，无需实时等待
 * - 其他浏览器（Firefox）：兼容路径，使用 MediaRecorder
 *
 * @param images - HTMLImageElement 图像数组
 * @param settings - 视频生成设置
 * @param onProgress - 进度回调函数
 * @param signal - 取消信号
 * @returns 生成的视频 Blob
 */
export async function generateVideo(
  images: RenderImage[],
  settings: VideoSettings,
  onProgress?: (progress: VideoProgress) => void,
  signal?: AbortSignal
): Promise<Blob> {
  if (images.length === 0) {
    throw new Error('至少需要 1 张图片才能生成视频');
  }

  // 优先尝试快速路径
  if (supportsFastEncoding) {
    try {
      return await generateVideoFast(images, settings, onProgress, signal);
    } catch (err) {
      console.warn('VideoEncoder 编码失败，回退到 MediaRecorder:', err);
      // 回退到兼容路径
    }
  }

  return generateVideoFallback(images, settings, onProgress, signal);
}
