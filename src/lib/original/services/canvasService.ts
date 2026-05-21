import { LogoSettings } from "../types";

export const applyGlobalCrop = async (
  baseImageUrl: string,
  targetAspect: number | null,
  exactWidth?: number,
  exactHeight?: number
): Promise<{ url: string, dims: { width: number; height: number } }> => {
  const baseImage = await loadElementImage(baseImageUrl);

  let drawWidth = baseImage.naturalWidth;
  let drawHeight = baseImage.naturalHeight;
  let srcX = 0;
  let srcY = 0;
  let srcW = drawWidth;
  let srcH = drawHeight;

  // Determine actual target aspect ratio
  const aspectToUse = targetAspect !== null ? targetAspect : (exactWidth && exactHeight ? exactWidth / exactHeight : null);

  if (aspectToUse) {
     const imgAspect = drawWidth / drawHeight;
     if (imgAspect > aspectToUse) {
        // Image is wider than target
        srcW = drawHeight * aspectToUse;
        srcX = (drawWidth - srcW) / 2;
     } else {
        // Image is taller than target
        srcH = drawWidth / aspectToUse;
        srcY = (drawHeight - srcH) / 2;
     }
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法获取 Canvas 上下文");

  canvas.width = targetAspect === null && exactWidth ? exactWidth : srcW;
  canvas.height = targetAspect === null && exactHeight ? exactHeight : srcH;

  ctx.drawImage(
    baseImage,
    srcX, srcY, srcW, srcH, // Source
    0, 0, canvas.width, canvas.height // Dest
  );

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
         resolve({
           url: canvas.toDataURL("image/png"),
           dims: { width: canvas.width, height: canvas.height }
         });
         return;
      }
      resolve({
        url: URL.createObjectURL(blob),
        dims: { width: canvas.width, height: canvas.height }
      });
    }, 'image/png');
  });
};

export const loadElementImage = (src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });
};

export const getImageDimensions = async (src: string): Promise<{ width: number; height: number }> => {
  const img = await loadElementImage(src);
  return { width: img.naturalWidth, height: img.naturalHeight };
};

export const applyLogoToImage = async (
  baseImageUrl: string,
  logoUrl: string | null,
  settings: LogoSettings,
  targetDimensions?: { width: number; height: number },
  preloadedLogo?: HTMLImageElement | null
): Promise<string> => {
  const baseImage = await loadElementImage(baseImageUrl);

  const width = targetDimensions?.width ?? baseImage.naturalWidth;
  const height = targetDimensions?.height ?? baseImage.naturalHeight;

  // Optimization: If no logo and dimensions already match, return original
  if (!logoUrl && baseImage.naturalWidth === width && baseImage.naturalHeight === height) {
    return baseImageUrl;
  }

  if (logoUrl && !preloadedLogo) {
    // If we have a logo, we need to load it early to fail fast if broken
    await loadElementImage(logoUrl);
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("无法获取 Canvas 上下文");
  }

  // Set canvas size to target dimensions
  canvas.width = width;
  canvas.height = height;

  // Draw base image, scaling to fit the canvas
  ctx.drawImage(baseImage, 0, 0, width, height);

  if (logoUrl) {
    const logoImage = preloadedLogo || await loadElementImage(logoUrl);

    // Calculate logo dimensions
    const logoAspectRatio = logoImage.naturalWidth / logoImage.naturalHeight;

    // Calculate width based on percentage of canvas width
    const drawWidth = (canvas.width * settings.scale) / 100;
    const drawHeight = drawWidth / logoAspectRatio;

    // Calculate position based on percentages
    const x = (canvas.width * settings.x) / 100;
    const y = (canvas.height * settings.y) / 100;

    // Apply opacity
    ctx.globalAlpha = settings.opacity;

    // Draw logo
    ctx.drawImage(logoImage, x, y, drawWidth, drawHeight);

    // Reset opacity
    ctx.globalAlpha = 1.0;
  }

  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
         resolve(canvas.toDataURL("image/png"));
         return;
      }
      resolve(URL.createObjectURL(blob));
    }, 'image/png');
  });
};
