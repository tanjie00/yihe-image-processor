import imageCompression from 'browser-image-compression';

export async function getCroppedImg(
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number },
  rotation = 0,
  flip = { horizontal: false, vertical: false }
): Promise<File> {
    const image = new Image();
    image.src = imageSrc;
    await new Promise<void>((res, rej) => { image.onload = () => res(); image.onerror = rej; });

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      throw new Error('No 2d context');
    }

    // Set canvas dimensions to the crop box size
    canvas.width = pixelCrop.width;
    canvas.height = pixelCrop.height;

    // Draw the cropped portion
    ctx.drawImage(
      image,
      pixelCrop.x,
      pixelCrop.y,
      pixelCrop.width,
      pixelCrop.height,
      0,
      0,
      pixelCrop.width,
      pixelCrop.height
    );

    // Convert to file and compress losslessly (using high quality WebP/PNG)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b) resolve(b);
        else reject(new Error('Canvas is empty'));
      }, 'image/png');
    });

    const file = new File([blob], 'cropped.png', { type: 'image/png' });

    try {
      const compressedBlob = await imageCompression(file, {
        maxSizeMB: 5,
        maxWidthOrHeight: 8192,
        useWebWorker: false,
        initialQuality: 1, // 1 = 100% quality (lossless)
        fileType: 'image/png', // Keep as PNG for lossless transparency
        alwaysKeepResolution: true // Ensure dimensions are untouched
      });

      return new File([compressedBlob], 'cropped.png', { type: 'image/png' });
    } catch (err) {
      console.warn("Compression failed, using uncompressed output:", err);
      return file;
    }
}
