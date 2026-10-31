export interface CompressionResult {
  file: File;
  width: number;
  height: number;
  originalSize: number;
  compressedSize: number;
}

const MAX_DIMENSION = 1920;
const COMPRESSION_QUALITY = 0.82;

/**
 * Checks if a Canvas contains any transparent pixels.
 */
function hasTransparency(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): boolean {
  // Sample pixels to quickly detect transparency without scanning entire huge buffer
  try {
    const step = Math.max(1, Math.floor(Math.min(width, height) / 20));
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const pixel = ctx.getImageData(x, y, 1, 1).data;
        if (pixel[3] < 250) {
          return true;
        }
      }
    }
  } catch {
    // If security policy or CORS blocks getImageData, assume potential transparency
  }
  return false;
}

/**
 * Compresses an image file client-side before uploading to Backblaze B2.
 */
export async function compressImage(file: File): Promise<CompressionResult> {
  const originalSize = file.size;

  // If GIF or SVG, do not compress to avoid breaking animation or vectors
  if (
    file.type === "image/gif" ||
    file.type === "image/svg+xml" ||
    file.name.toLowerCase().endsWith(".gif") ||
    file.name.toLowerCase().endsWith(".svg")
  ) {
    return {
      file,
      width: 0,
      height: 0,
      originalSize,
      compressedSize: originalSize,
    };
  }

  // Load bitmap with automatic EXIF orientation handling
  let imageBitmap: ImageBitmap | null = null;
  let imgElement: HTMLImageElement | null = null;
  let origWidth = 0;
  let origHeight = 0;

  if (typeof createImageBitmap !== "undefined") {
    try {
      imageBitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      origWidth = imageBitmap.width;
      origHeight = imageBitmap.height;
    } catch {
      imageBitmap = null;
    }
  }

  if (!imageBitmap) {
    // Fallback to HTMLImageElement
    imgElement = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not load image for compression."));
      };
      img.src = url;
    });
    origWidth = imgElement.naturalWidth || imgElement.width;
    origHeight = imgElement.naturalHeight || imgElement.height;
  }

  // Calculate target dimensions preserving aspect ratio
  let targetWidth = origWidth;
  let targetHeight = origHeight;

  if (targetWidth > MAX_DIMENSION || targetHeight > MAX_DIMENSION) {
    if (targetWidth > targetHeight) {
      targetHeight = Math.round((targetHeight * MAX_DIMENSION) / targetWidth);
      targetWidth = MAX_DIMENSION;
    } else {
      targetWidth = Math.round((targetWidth * MAX_DIMENSION) / targetHeight);
      targetHeight = MAX_DIMENSION;
    }
  }

  // If already small and no dimension resizing needed, return original
  if (
    originalSize < 300 * 1024 &&
    targetWidth === origWidth &&
    targetHeight === origHeight
  ) {
    if (imageBitmap) imageBitmap.close();
    return {
      file,
      width: origWidth,
      height: origHeight,
      originalSize,
      compressedSize: originalSize,
    };
  }

  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    if (imageBitmap) imageBitmap.close();
    return {
      file,
      width: origWidth,
      height: origHeight,
      originalSize,
      compressedSize: originalSize,
    };
  }

  if (imageBitmap) {
    ctx.drawImage(imageBitmap, 0, 0, targetWidth, targetHeight);
    imageBitmap.close();
  } else if (imgElement) {
    ctx.drawImage(imgElement, 0, 0, targetWidth, targetHeight);
  }

  const isPng =
    file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
  const containsAlpha = isPng && hasTransparency(ctx, targetWidth, targetHeight);

  // If PNG has transparency, keep PNG or WEBP; otherwise JPEG offers best compression
  let targetType = "image/jpeg";
  let targetExt = "jpg";

  if (containsAlpha) {
    targetType = "image/png";
    targetExt = "png";
  } else if (file.type === "image/webp") {
    targetType = "image/webp";
    targetExt = "webp";
  }

  const compressedBlob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob),
      targetType,
      targetType === "image/png" ? undefined : COMPRESSION_QUALITY
    );
  });

  if (!compressedBlob || compressedBlob.size >= originalSize) {
    // If compression did not reduce file size, use original
    return {
      file,
      width: origWidth,
      height: origHeight,
      originalSize,
      compressedSize: originalSize,
    };
  }

  const baseName = file.name.replace(/\.[^/.]+$/, "");
  const compressedFile = new File(
    [compressedBlob],
    `${baseName}.${targetExt}`,
    {
      type: targetType,
      lastModified: Date.now(),
    }
  );

  return {
    file: compressedFile,
    width: targetWidth,
    height: targetHeight,
    originalSize,
    compressedSize: compressedBlob.size,
  };
}
