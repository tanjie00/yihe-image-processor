/**
 * 视频生成服务
 * 基于 Canvas API 和 MediaRecorder API，从图像序列生成带转场效果的视频
 */

import { TRANSITIONS } from './transitions';
import type { VideoAspectRatio, TransitionTypeName, VideoSettings, VideoProgress } from './types';

// 重新导出类型，方便外部直接从此模块导入
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

/** 转场效果中文标签，用于 UI 展示 */
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

// ==================== 辅助函数 ====================

/**
 * 根据宽高比获取视频分辨率
 * @param ratio - 宽高比类型
 * @param customWidth - 自定义宽度（ratio 为 'custom' 时必传）
 * @param customHeight - 自定义高度（ratio 为 'custom' 时必传）
 * @returns 包含 width 和 height 的对象
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

/**
 * 以 cover 模式绘制图像到画布（保持比例填满，居中裁剪）
 */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  canvasWidth: number,
  canvasHeight: number
): void {
  const imgRatio = img.naturalWidth / img.naturalHeight;
  const canvasRatio = canvasWidth / canvasHeight;
  let sx: number, sy: number, sw: number, sh: number;

  if (imgRatio > canvasRatio) {
    // 图像更宽，以高度为基准裁剪宽度
    sh = img.naturalHeight;
    sw = sh * canvasRatio;
    sx = (img.naturalWidth - sw) / 2;
    sy = 0;
  } else {
    // 图像更高，以宽度为基准裁剪高度
    sw = img.naturalWidth;
    sh = sw / canvasRatio;
    sx = 0;
    sy = (img.naturalHeight - sh) / 2;
  }

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvasWidth, canvasHeight);
}

/**
 * 让出事件循环，避免阻塞 UI
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ==================== 主函数 ====================

/**
 * 从图像序列生成带转场效果的视频
 *
 * 帧计算逻辑：
 * - 每张图像展示 imageDuration 秒，对应 imageDuration * fps 帧
 * - 相邻图像之间有 transitionDuration 秒的转场，对应 transitionDuration * fps 帧
 * - 转场发生在当前图像展示期的末尾，与下一张图像的展示期重叠
 * - 因此总时长 = imageDuration * images.length + transitionDuration * (images.length - 1)
 * - 但由于转场是重叠的，实际总帧数 = imageDuration * fps * images.length + transitionDuration * fps * (images.length - 1)
 *
 * 重要：使用 captureStream(0) + requestFrame() 手动控制帧捕获，
 * 并按目标帧率间隔渲染每帧，确保所有帧都被正确捕获和编码。
 *
 * @param images - HTMLImageElement 图像数组
 * @param settings - 视频生成设置
 * @param onProgress - 进度回调函数
 * @param signal - 取消信号，支持中止生成
 * @returns 生成的视频 Blob
 */
export async function generateVideo(
  images: HTMLImageElement[],
  settings: VideoSettings,
  onProgress?: (progress: VideoProgress) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const {
    fps,
    imageDuration,
    transitionDuration,
    transition,
    quality,
  } = settings;

  // 获取画布分辨率
  const { width, height } = getAspectRatioResolution(
    settings.aspectRatio,
    settings.customWidth,
    settings.customHeight
  );

  // 计算帧数
  const imageFrames = Math.round(imageDuration * fps); // 每张图像的展示帧数
  const transitionFrames = Math.round(transitionDuration * fps); // 每次转场的帧数
  const totalFrames = imageFrames * images.length + transitionFrames * (images.length - 1);

  // 每张图像在总时间线中的起始帧
  const imageStartFrames: number[] = [];
  for (let i = 0; i < images.length; i++) {
    imageStartFrames.push(i * (imageFrames + transitionFrames));
  }

  // 阶段一：准备画布和录制器
  onProgress?.({
    phase: 'preparing',
    current: 0,
    total: totalFrames,
    percent: 0,
  });

  // 创建画布
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // 获取转场渲染函数
  const transitionRenderer = TRANSITIONS[transition];

  // 根据质量计算比特率（vp9 编码）
  const pixels = width * height;
  const baseBitrate = Math.round(pixels * fps * 0.1);
  const bitrate = Math.round(baseBitrate * (0.5 + quality * 1.5));

  // ── 关键修复：使用 captureStream(0) 手动控制帧捕获 ──
  // captureStream(fps) 会按实际时间以 fps 速率自动捕获帧，
  // 但如果渲染循环运行过快（远超实时），大部分帧会被跳过，
  // 导致视频时长几乎为 0 且画面不完整。
  // 使用 captureStream(0) 后，需手动调用 requestFrame() 来捕获每一帧，
  // 并按正确的帧间隔调度渲染，确保每帧都被捕获且时间戳正确。
  const stream = canvas.captureStream(0);
  const videoTrack = stream.getVideoTracks()[0];

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: bitrate,
  });

  // 收集录制的数据块
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e: BlobEvent) => {
    if (e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  // 阶段二：渲染每一帧
  onProgress?.({
    phase: 'rendering',
    current: 0,
    total: totalFrames,
    percent: 0,
  });

  // 开始录制，设定 timeslice 以定期获取数据，避免内存堆积
  recorder.start(1000);

  // 帧间隔（毫秒），用于控制渲染节奏和帧时间戳
  const frameInterval = 1000 / fps;

  // 逐帧渲染，按目标帧率间隔调度
  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    // 检查取消信号
    if (signal?.aborted) {
      recorder.stop();
      throw new DOMException('视频生成已取消', 'AbortError');
    }

    // 清空画布
    ctx.clearRect(0, 0, width, height);

    // 确定当前帧属于哪张图像，以及是否在转场区域
    let currentImageIndex = -1;
    let isInTransition = false;
    let transitionProgress = 0;
    let nextImageIndex = -1;

    for (let i = 0; i < images.length; i++) {
      const startFrame = imageStartFrames[i];
      const endFrame = startFrame + imageFrames + transitionFrames;

      if (frameIndex >= startFrame && frameIndex < endFrame) {
        currentImageIndex = i;

        const transitionStartFrame = startFrame + imageFrames;
        if (i < images.length - 1 && frameIndex >= transitionStartFrame) {
          isInTransition = true;
          nextImageIndex = i + 1;
          transitionProgress = (frameIndex - transitionStartFrame) / transitionFrames;
          transitionProgress = Math.min(1, Math.max(0, transitionProgress));
        }
        break;
      }
    }

    if (currentImageIndex === -1) {
      continue;
    }

    // 渲染当前帧到画布
    if (isInTransition && nextImageIndex !== -1) {
      transitionRenderer(
        ctx,
        images[currentImageIndex],
        images[nextImageIndex],
        transitionProgress,
        width,
        height
      );
    } else {
      drawImageCover(ctx, images[currentImageIndex], width, height);
    }

    // 手动请求捕获当前画布帧
    if (videoTrack && 'requestFrame' in videoTrack) {
      (videoTrack as any).requestFrame();
    }

    // 更新进度
    onProgress?.({
      phase: 'rendering',
      current: frameIndex + 1,
      total: totalFrames,
      percent: Math.round(((frameIndex + 1) / totalFrames) * 100),
    });

    // ── 关键：按帧间隔等待，确保帧时间戳正确 ──
    // 使用 requestAnimationFrame 实现与屏幕刷新同步的等待，
    // 这样既保证帧时间戳间距接近 frameInterval，又不会阻塞 UI。
    // 对于 30fps 视频，每帧约 33ms，RAF 约 16ms 一次，
    // 所以每帧约等待 2 个 RAF 周期 ≈ 32ms，接近目标间隔。
    await new Promise<void>((resolve) => {
      const deadline = performance.now() + frameInterval;
      const tick = () => {
        if (performance.now() >= deadline) {
          resolve();
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });

    // 每 30 帧额外让出一次事件循环，避免长时间占用主线程
    if (frameIndex % 30 === 0) {
      await yieldToEventLoop();
    }
  }

  // 阶段三：编码完成，停止录制
  onProgress?.({
    phase: 'encoding',
    current: totalFrames,
    total: totalFrames,
    percent: 100,
  });

  // 等待最后一帧被编码器处理
  await new Promise(resolve => setTimeout(resolve, 200));

  // 停止录制并等待数据收集完成
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
