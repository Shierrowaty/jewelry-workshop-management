import { expect, type Page } from "@playwright/test";
import { QUOTES_DATABASE_NAME } from "../src/features/quotes/data/database";
import type { QuotePhoto } from "../src/features/quotes/photos/types";

export async function readPhotos(page: Page) {
  return page.evaluate(async (name) => {
    const photos = await new Promise<QuotePhoto[]>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const transaction = db.transaction("quotePhotos", "readonly");
        const records = transaction.objectStore("quotePhotos").getAll();
        transaction.oncomplete = () => { db.close(); resolve(records.result); };
        transaction.onabort = () => { db.close(); reject(transaction.error); };
      };
    });
    return Promise.all(photos.map(async ({ blob, ...metadata }) => {
      if (!blob) return { ...metadata, hasBlob: false, hash: "", decodedWidth: 0, decodedHeight: 0, cornerAlpha: 0 };
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, bitmap.width - 1, bitmap.height - 1, 1, 1, 0, 0, 1, 1);
      const cornerAlpha = context.getImageData(0, 0, 1, 1).data[3];
      const dimensions = { decodedWidth: bitmap.width, decodedHeight: bitmap.height };
      bitmap.close();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))).join(",");
      return { ...metadata, hasBlob: blob instanceof Blob, hash, ...dimensions, cornerAlpha };
    }));
  }, QUOTES_DATABASE_NAME);
}

export async function expectPhotoCount(page: Page, count: number) {
  const gallery = page.getByRole("region", { name: "Zdjęcia realizacji", exact: true });
  await expect(gallery.getByText(`Zdjęcia: ${count}`, { exact: true })).toBeVisible();
  await expect(gallery.getByRole("button", { name: /^Otwórz zdjęcie:/ })).toHaveCount(count);
}

export async function addTestPhotos(page: Page) {
  // Synthetic files exist only in the isolated browser/test memory. No user files or DB are touched.
  const fixtures = await page.evaluate(async () => {
    async function generate(width: number, height: number, type: string) {
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#ba9557";
      context.fillRect(0, 0, width / 2, height);
      context.fillStyle = "#28332b";
      context.fillRect(0, 0, width / 2, height / 2);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), type, 0.95));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    }
    return { small: await generate(320, 240, "image/png"), large: await generate(3000, 1800, "image/png"), portrait: await generate(2400, 1600, "image/jpeg") };
  });
  const small = { name: "maly-detal.png", mimeType: "image/png", buffer: Buffer.from(fixtures.small) };
  const originalHash = await page.evaluate(async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)))).join(","), fixtures.small);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Dodaj zdjęcia", exact: true }).click();
  await (await chooser).setFiles(small);
  await expectPhotoCount(page, 1);
  expect((await readPhotos(page))[0]).toMatchObject({ fileName: "maly-detal.png", size: small.buffer.length, mimeType: "image/png", width: 320, height: 240, hash: originalHash });

  // Valid JPEG APP1/EXIF orientation=6 rotates this landscape source into a portrait.
  const exif = Buffer.from([0xff, 0xe1, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0]);
  const jpeg = Buffer.from(fixtures.portrait);
  await page.getByLabel("Wybierz zdjęcia realizacji").setInputFiles([
    // Trailing bytes after PNG IEND are ignored by decoders; exercise a real 12 MiB upload too.
    { name: "duzy-detal.png", mimeType: "image/png", buffer: Buffer.concat([Buffer.from(fixtures.large), Buffer.alloc(12 * 1024 * 1024)]) },
    { name: "pionowe.jpg", mimeType: "image/jpeg", buffer: Buffer.concat([jpeg.subarray(0, 2), exif, jpeg.subarray(2)]) },
    { name: "uszkodzone.jpg", mimeType: "image/jpeg", buffer: Buffer.from([0xff, 0xd8, 0xff, 0, 0]) },
    { name: "telefon.heic", mimeType: "image/heic", buffer: Buffer.from("unsupported") },
  ]);
  // A batch includes 12 MiB input and EXIF rotation; await completion before counting.
  const gallery = page.getByRole("region", { name: "Zdjęcia realizacji", exact: true });
  await expect(gallery.getByRole("button", { name: "Dodaj zdjęcia", exact: true })).toBeEnabled({ timeout: 30_000 });
  await expectPhotoCount(page, 3);
  await expect(gallery.getByRole("status")).toHaveText("Zapisano lokalnie zdjęcia: 2 z 4.");
  await expect(gallery.getByRole("alert")).toContainText("uszkodzone.jpg");
  await expect(gallery.getByRole("alert")).toContainText("HEIC/HEIF");
  const photos = await readPhotos(page);
  expect(photos.find((photo) => photo.originalFileName === "duzy-detal.png")).toMatchObject({ fileName: "duzy-detal.webp", mimeType: "image/webp", width: 1920, height: 1152, decodedWidth: 1920, decodedHeight: 1152, cornerAlpha: 0 });
  expect(photos.find((photo) => photo.originalFileName === "pionowe.jpg")).toMatchObject({ fileName: "pionowe.webp", width: 1280, height: 1920, decodedWidth: 1280, decodedHeight: 1920 });
  for (const photo of photos) { expect(photo.hasBlob).toBe(true); expect(photo.size).toBeLessThanOrEqual(2 * 1024 * 1024); }

  await page.getByRole("button", { name: "Otwórz zdjęcie: pionowe.jpg", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "pionowe.jpg" })).toBeVisible();
  await expect.poll(() => page.getByRole("dialog").getByRole("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Otwórz zdjęcie: pionowe.jpg", exact: true })).toBeFocused();
  return photos;
}

export async function removeOnePhoto(page: Page) {
  const before = await readPhotos(page);
  const otherTab = await page.context().newPage();
  await otherTab.goto(page.url());
  await expectPhotoCount(otherTab, 3);
  await otherTab.getByRole("button", { name: "Otwórz zdjęcie: maly-detal.png" }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Usuń zdjęcie: maly-detal.png" }).click();
  expect(await readPhotos(page)).toEqual(before);
  page.once("dialog", async (dialog) => { expect(dialog.message()).toContain("Oryginalny plik"); await dialog.accept(); });
  await page.getByRole("button", { name: "Usuń zdjęcie: maly-detal.png" }).click();
  await expectPhotoCount(page, 2);
  await expectPhotoCount(otherTab, 2);
  await expect(otherTab.getByRole("dialog")).toHaveCount(0);
  await otherTab.close();
  await page.reload();
  await expectPhotoCount(page, 2);
  const after = await readPhotos(page);
  expect(after.filter((photo) => photo.deletedAt === null)).toEqual(before.filter((photo) => photo.originalFileName !== "maly-detal.png"));
  expect(after.find((photo) => photo.originalFileName === "maly-detal.png")).toMatchObject({ hasBlob: false, revision: 2, syncStatus: "pending" });
  // Adding another photo later also works after deletion and a browser restart.
  const file = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
    const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), "image/png"));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.getByLabel("Wybierz zdjęcia realizacji").setInputFiles({ name: "kolejne.png", mimeType: "image/png", buffer: Buffer.from(file) });
  await expectPhotoCount(page, 3);
  await page.reload();
  await expectPhotoCount(page, 3);
}
