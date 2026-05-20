import { loadElementImage } from './canvasService';

export interface SliceResult {
  url: string;
  width: number;
  height: number;
  index: number;
}

/**
 * 将长图按指定比例垂直切片
 * @param imageUrl 原始图片 URL
 * @param ratio 比例模式: '1:1' | '3:4' | 'custom'
 * @param customWidthPx 自定义宽度(px)，仅 ratio='custom' 时有效
 * @param customHeightPx 自定义高度(px)，仅 ratio='custom' 时有效
 * @param onProgress 进度回调
 */
export const sliceImage = async (
  imageUrl: string,
  ratio: '1:1' | '3:4' | 'custom',
  customWidthPx?: number,
  customHeightPx?: number,
  onProgress?: (current: number, total: number) => void
): Promise<SliceResult[]> => {
  const img = await loadElementImage(imageUrl);
  const W = img.naturalWidth;
  const H = img.naturalHeight;

  // 计算每张切片的高度（像素）
  let sliceHeight: number;

  if (ratio === '1:1') {
    // 1:1 => H_slice = W * (1/1) = W
    sliceHeight = W;
  } else if (ratio === '3:4') {
    // 3:4 => H_slice = W * (4/3)
    sliceHeight = Math.round(W * (4 / 3));
  } else {
    // 自定义像素尺寸，按宽度等比缩放高度
    const wPx = customWidthPx || 800;
    const hPx = customHeightPx || 800;
    const scale = W / wPx;
    sliceHeight = Math.round(hPx * scale);
  }

  if (sliceHeight <= 0) {
    throw new Error('切片高度计算异常，请检查参数');
  }

  const totalSlices = Math.ceil(H / sliceHeight);
  const results: SliceResult[] = [];

  for (let i = 0; i < totalSlices; i++) {
    const srcY = i * sliceHeight;
    const srcH = Math.min(sliceHeight, H - srcY);

    // 最后一片不足时，按实际剩余高度截取（不上填白底）
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = srcH;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法获取 Canvas 上下文');

    ctx.drawImage(img, 0, srcY, W, srcH, 0, 0, W, srcH);

    const url = await new Promise<string>((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(canvas.toDataURL('image/png'));
          return;
        }
        resolve(URL.createObjectURL(blob));
      }, 'image/png');
    });

    results.push({
      url,
      width: W,
      height: srcH,
      index: i,
    });

    onProgress?.(i + 1, totalSlices);
  }

  return results;
};
