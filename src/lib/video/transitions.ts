/**
 * 视频转场效果模块
 * 提供基于 Canvas 的各种转场特效，用于视频合成功能。
 * 每个转场函数接收两张图片（当前帧和下一帧）、Canvas 上下文、
 * 进度值（0-1）以及画布尺寸，并在 Canvas 上绘制对应的转场效果。
 */

import type { TransitionTypeName } from './types';

// ============================================================
// 类型定义
// ============================================================

/**
 * 转场效果渲染函数类型
 *
 * @param ctx - Canvas 2D 渲染上下文
 * @param fromImg - 转场起始图片（即将离开的画面）
 * @param toImg - 转场目标图片（即将进入的画面）
 * @param progress - 转场进度，范围 0（开始）到 1（结束）
 * @param width - 画布宽度
 * @param height - 画布高度
 */
export type TransitionRenderer = (
  ctx: CanvasRenderingContext2D,
  fromImg: HTMLImageElement,
  toImg: HTMLImageElement,
  progress: number,
  width: number,
  height: number
) => void;

// ============================================================
// 工具函数
// ============================================================

/**
 * 以 "cover" 模式绘制图片到 Canvas
 *
 * 类似于 CSS 的 `object-fit: cover`，图片会等比缩放填满整个画布，
 * 超出部分会被裁剪，确保画面无留白。
 *
 * @param ctx - Canvas 2D 渲染上下文
 * @param img - 要绘制的图片元素
 * @param width - 目标画布宽度
 * @param height - 目标画布高度
 */
export function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number
): void {
  if (!img.naturalWidth || !img.naturalHeight) return;

  const imgRatio = img.naturalWidth / img.naturalHeight;
  const canvasRatio = width / height;

  let drawWidth: number;
  let drawHeight: number;
  let cropX: number;
  let cropY: number;

  if (imgRatio > canvasRatio) {
    // 图片更宽，以高度为基准缩放，裁剪两侧
    drawHeight = img.naturalHeight;
    drawWidth = img.naturalHeight * canvasRatio;
    cropX = (img.naturalWidth - drawWidth) / 2;
    cropY = 0;
  } else {
    // 图片更高，以宽度为基准缩放，裁剪上下
    drawWidth = img.naturalWidth;
    drawHeight = img.naturalWidth / canvasRatio;
    cropX = 0;
    cropY = (img.naturalHeight - drawHeight) / 2;
  }

  ctx.drawImage(
    img,
    cropX,
    cropY,
    drawWidth,
    drawHeight,
    0,
    0,
    width,
    height
  );
}

/**
 * 基于种子的伪随机数生成器（线性同余法）
 *
 * 用于溶解和颗粒化效果，确保相同种子产生相同的随机序列，
 * 从而在转场过程中保持一致性。
 *
 * @param seed - 随机种子
 * @returns 0 到 1 之间的伪随机数
 */
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// ============================================================
// 缓动函数
// ============================================================

/**
 * 三次缓入缓出函数
 *
 * 动画开始和结束时速度较慢，中间速度较快，
 * 使转场效果更加自然流畅。
 *
 * @param t - 进度值，范围 0 到 1
 * @returns 缓动后的进度值
 */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ============================================================
// 转场效果实现
// ============================================================

/**
 * 淡入淡出
 *
 * 最基础的转场效果，当前画面透明度逐渐降低，
 * 下一画面透明度逐渐升高，实现平滑的交叉溶解。
 */
const fade: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  // 绘制起始帧，透明度随进度递减
  ctx.globalAlpha = 1 - progress;
  drawImageCover(ctx, fromImg, width, height);

  // 绘制目标帧，透明度随进度递增
  ctx.globalAlpha = progress;
  drawImageCover(ctx, toImg, width, height);

  // 恢复默认透明度
  ctx.globalAlpha = 1;
};

/**
 * 左滑
 *
 * 目标画面从右侧滑入，起始画面同步向左滑出，
 * 形成水平推动的效果。
 */
const slideLeft: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  // 起始帧向左移动
  ctx.save();
  ctx.translate(-progress * width, 0);
  drawImageCover(ctx, fromImg, width, height);
  ctx.restore();

  // 目标帧从右侧滑入
  ctx.save();
  ctx.translate((1 - progress) * width, 0);
  drawImageCover(ctx, toImg, width, height);
  ctx.restore();
};

/**
 * 右滑
 *
 * 目标画面从左侧滑入，起始画面同步向右滑出，
 * 形成反方向水平推动的效果。
 */
const slideRight: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  // 起始帧向右移动
  ctx.save();
  ctx.translate(progress * width, 0);
  drawImageCover(ctx, fromImg, width, height);
  ctx.restore();

  // 目标帧从左侧滑入
  ctx.save();
  ctx.translate(-(1 - progress) * width, 0);
  drawImageCover(ctx, toImg, width, height);
  ctx.restore();
};

/**
 * 上滑
 *
 * 目标画面从底部滑入，起始画面同步向上滑出，
 * 形成垂直推动的效果。
 */
const slideUp: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  // 起始帧向上移动
  ctx.save();
  ctx.translate(0, -progress * height);
  drawImageCover(ctx, fromImg, width, height);
  ctx.restore();

  // 目标帧从底部滑入
  ctx.save();
  ctx.translate(0, (1 - progress) * height);
  drawImageCover(ctx, toImg, width, height);
  ctx.restore();
};

/**
 * 下滑
 *
 * 目标画面从顶部滑入，起始画面同步向下滑出，
 * 形成反方向垂直推动的效果。
 */
const slideDown: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  // 起始帧向下移动
  ctx.save();
  ctx.translate(0, progress * height);
  drawImageCover(ctx, fromImg, width, height);
  ctx.restore();

  // 目标帧从顶部滑入
  ctx.save();
  ctx.translate(0, -(1 - progress) * height);
  drawImageCover(ctx, toImg, width, height);
  ctx.restore();
};

/**
 * 圆形缩放
 *
 * 以画面中心为圆心，一个圆形区域逐渐扩大，
 * 圆内显示目标画面，圆外显示起始画面。
 * 使用 easeInOut 缓动函数使动画更加自然。
 */
const circleZoom: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  // 先绘制起始帧作为背景
  drawImageCover(ctx, fromImg, width, height);

  // 使用缓动函数使圆形扩展更平滑
  const easedProgress = easeInOutCubic(progress);

  // 计算最大半径（画布对角线的一半，确保完全覆盖）
  const maxRadius = Math.sqrt(width * width + height * height) / 2;
  const radius = maxRadius * easedProgress;

  // 中心坐标
  const centerX = width / 2;
  const centerY = height / 2;

  // 在圆形区域内绘制目标帧
  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.clip();
  drawImageCover(ctx, toImg, width, height);
  ctx.restore();
};

/**
 * 溶解
 *
 * 将画面分成若干像素块，每个块按照随机的顺序
 * 从起始画面切换到目标画面，形成溶解消散的效果。
 * 使用种子随机保证同一次转场中随机顺序一致。
 */
const dissolve: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  // 像素块大小
  const blockSize = 12;

  // 先绘制目标帧作为底层
  drawImageCover(ctx, toImg, width, height);

  // 在上方覆盖起始帧，按块逐步隐藏
  for (let x = 0; x < width; x += blockSize) {
    for (let y = 0; y < height; y += blockSize) {
      // 基于位置生成种子，确保每次运行结果一致
      const seed = x * 1000 + y + 7;
      const threshold = seededRandom(seed);

      // 当进度超过该块的阈值时，该块从起始帧"溶解"消失
      if (progress >= threshold) {
        continue; // 不绘制起始帧的该块，露出底层目标帧
      }

      // 绘制起始帧的对应块
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, blockSize, blockSize);
      ctx.clip();
      drawImageCover(ctx, fromImg, width, height);
      ctx.restore();
    }
  }
};

/**
 * 颗粒化
 *
 * 类似溶解效果，但使用更小的颗粒尺寸，并加入
 * 噪声扰动，产生更加细腻的颗粒状溶解视觉。
 * 效果更加随机和碎片化，类似电视信号干扰。
 */
const granular: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  // 颗粒尺寸，比溶解更小
  const grainSize = 6;

  // 先绘制目标帧作为底层
  drawImageCover(ctx, toImg, width, height);

  // 逐颗粒判断是否显示起始帧
  for (let x = 0; x < width; x += grainSize) {
    for (let y = 0; y < height; y += grainSize) {
      // 基于位置和额外偏移生成种子，增加随机性
      const seed = x * 7919 + y * 104729 + 42;
      const threshold = seededRandom(seed);

      // 加入轻微噪声扰动，使颗粒过渡更自然
      const noise = seededRandom(seed + 1) * 0.15;
      const adjustedThreshold = Math.max(0, Math.min(1, threshold + noise - 0.075));

      // 当进度超过该颗粒的阈值时，隐藏起始帧对应颗粒
      if (progress >= adjustedThreshold) {
        continue;
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, grainSize, grainSize);
      ctx.clip();
      drawImageCover(ctx, fromImg, width, height);
      ctx.restore();
    }
  }
};

/**
 * 水平百叶窗
 *
 * 画面被分成若干水平条带，类似百叶窗叶片，
 * 每个条带从中心向上下两侧展开，逐渐露出目标画面。
 */
const blindsH: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  // 百叶窗条带数量
  const stripCount = 10;
  const stripHeight = height / stripCount;

  // 先绘制起始帧作为背景
  drawImageCover(ctx, fromImg, width, height);

  // 每个条带中绘制目标帧，高度随进度展开
  for (let i = 0; i < stripCount; i++) {
    const stripY = i * stripHeight;
    const stripCenter = stripY + stripHeight / 2;

    // 从中心向两侧展开的高度
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

/**
 * 垂直百叶窗
 *
 * 画面被分成若干垂直条带，类似竖直百叶窗叶片，
 * 每个条带从中心向左右两侧展开，逐渐露出目标画面。
 */
const blindsV: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  // 百叶窗条带数量
  const stripCount = 10;
  const stripWidth = width / stripCount;

  // 先绘制起始帧作为背景
  drawImageCover(ctx, fromImg, width, height);

  // 每个条带中绘制目标帧，宽度随进度展开
  for (let i = 0; i < stripCount; i++) {
    const stripX = i * stripWidth;
    const stripCenter = stripX + stripWidth / 2;

    // 从中心向两侧展开的宽度
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

/**
 * 从左覆盖
 *
 * 目标画面从左侧覆盖过来，起始画面保持不动，
 * 类似于幻灯片堆叠的效果。
 */
const coverLeft: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  // 起始帧保持不动
  drawImageCover(ctx, fromImg, width, height);

  // 目标帧从左侧覆盖过来
  const revealWidth = width * progress;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, revealWidth, height);
  ctx.clip();
  drawImageCover(ctx, toImg, width, height);
  ctx.restore();
};

/**
 * 从右覆盖
 *
 * 目标画面从右侧覆盖过来，起始画面保持不动，
 * 类似于反方向的幻灯片堆叠效果。
 */
const coverRight: TransitionRenderer = (ctx, fromImg, toImg, progress, width, height) => {
  // 起始帧保持不动
  drawImageCover(ctx, fromImg, width, height);

  // 目标帧从右侧覆盖过来
  const revealWidth = width * progress;
  ctx.save();
  ctx.beginPath();
  ctx.rect(width - revealWidth, 0, revealWidth, height);
  ctx.clip();
  drawImageCover(ctx, toImg, width, height);
  ctx.restore();
};

// ============================================================
// 转场效果映射表
// ============================================================

/**
 * 转场类型到渲染函数的映射
 *
 * 通过 TransitionTypeName 查找对应的转场渲染函数，
 * 便于动态选择和切换转场效果。
 */
export const TRANSITIONS: Record<TransitionTypeName, TransitionRenderer> = {
  fade,
  slideLeft,
  slideRight,
  slideUp,
  slideDown,
  circleZoom,
  dissolve,
  granular,
  blindsH,
  blindsV,
  coverLeft,
  coverRight,
};
