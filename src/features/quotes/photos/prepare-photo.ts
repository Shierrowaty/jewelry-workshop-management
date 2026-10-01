import { PHOTO_MAX_BYTES, PHOTO_MAX_EDGE, PhotoError, type PreparedPhoto } from "./types";

const KEEP_ORIGINAL_BYTES = 1024 * 1024;
const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const MAX_INPUT_PIXELS = 60_000_000;

export async function imageType(file: Blob) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "image/png";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  throw new PhotoError("Nieobsługiwany format. Wybierz JPEG, PNG lub WebP. Zdjęcie HEIC/HEIF najpierw wyeksportuj jako JPEG.");
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new PhotoError("Nie udało się przygotować zdjęcia. Spróbuj ponownie.")),
    type,
    0.86,
  ));
}

// Browser-only processing. Nothing is written to IndexedDB until this has finished.
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!file.size) throw new PhotoError("Plik jest pusty.");
  if (file.size > MAX_INPUT_BYTES) throw new PhotoError("Plik przekracza 40 MB. Wybierz mniejszą kopię zdjęcia.");
  const mimeType = await imageType(file);
  const original = file.slice(0, file.size, mimeType);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(original, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoError("Nie można odczytać zdjęcia. Plik może być uszkodzony lub nieobsługiwany przez przeglądarkę.");
  }
  let canvas: HTMLCanvasElement | undefined;
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MAX_INPUT_PIXELS) {
      throw new PhotoError("Zdjęcie ma zbyt dużą rozdzielczość (maksymalnie 60 megapikseli). Wybierz mniejszą kopię.");
    }
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const metadata = { originalFileName: file.name, width, height };
    if (scale === 1 && original.size <= KEEP_ORIGINAL_BYTES) {
      return { ...metadata, fileName: file.name, blob: original };
    }
    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new PhotoError("Przeglądarka nie może przygotować zdjęcia. Spróbuj ponownie.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    // WebP retains transparency. Unsupported encoders fall back to PNG; JPEG is safe for JPEG input.
    let blob = await encode(canvas, "image/webp");
    if (blob.type !== "image/webp" && mimeType === "image/jpeg") blob = await encode(canvas, "image/jpeg");
    if (scale === 1 && original.size <= PHOTO_MAX_BYTES && blob.size >= original.size) {
      return { ...metadata, fileName: file.name, blob: original };
    }
    if (blob.size > PHOTO_MAX_BYTES) throw new PhotoError("Nie udało się zmniejszyć zdjęcia do 2 MB przy dobrej jakości. Wybierz mniejszą kopię.");
    const extension = blob.type === "image/webp" ? "webp" : blob.type === "image/jpeg" ? "jpg" : "png";
    return { ...metadata, fileName: `${file.name.replace(/\.[^.]+$/, "") || "zdjecie"}.${extension}`, blob };
  } finally {
    bitmap.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}
