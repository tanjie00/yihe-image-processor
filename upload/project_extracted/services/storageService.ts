/**
 * Storage Service — persists app state across page navigations.
 * Settings → localStorage (synchronous, lightweight)
 * Image/Logo/Blob data → IndexedDB (async, handles binary data)
 */

import { ProcessedImage, ProcessStatus, LogoItem, BatchResult, LogoSettings, ProcessingMode, AiModel, SlicedPiece } from '../types';

// ── Serialized types (all fields must be structured-clone compatible) ──

interface SerializedImage {
  id: string;
  fileBuffer: ArrayBuffer;
  fileName: string;
  fileType: string;
  relativePath?: string;
  status: string;
  errorMessage?: string;
  completedAt?: number;
  resultBuffer?: ArrayBuffer;
  resultIsDataURL?: boolean;
  resultDataURL?: string;
}

interface SerializedLogo {
  id: string;
  fileBuffer: ArrayBuffer;
  fileName: string;
  fileType: string;
  name: string;
}

interface SerializedBatchResult {
  id: string;
  logoId: string;
  logoName: string;
  imageId: string;
  imageName: string;
  relativePath?: string;
  resultBuffer?: ArrayBuffer;
  resultIsDataURL?: boolean;
  resultDataURL?: string;
  status: string;
  errorMessage?: string;
}

interface SerializedSlicePiece {
  id: string;
  buffer: ArrayBuffer;
  width: number;
  height: number;
  index: number;
}

interface SerializedSliceResult {
  sourceImageId: string;
  sourceFileName: string;
  pieces: SerializedSlicePiece[];
  cropNodes?: number[];
  sourceImageUrl?: string;
}

export interface AppSettings {
  mode: ProcessingMode;
  aiModel: AiModel;
  logoSettings: LogoSettings;
  enableBatchCrop: boolean;
  batchCropAspect: number | null;
  batchCropWidth: number;
  batchCropHeight: number;
  detailCropRatio: '1:1' | '3:4' | 'custom' | 'manual';
  detailCropWidthPx: number;
  detailCropHeightPx: number;
  currentFolderPath: string | null;
  collapsedSections: string[];
}

// ── IndexedDB helpers ──

const DB_NAME = 'cleanslate_ai_db';
const DB_VERSION = 1;
const STORE_NAME = 'app_state';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => { db.close(); resolve(req.result as T | undefined); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

// ── Blob / URL helpers ──

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

async function urlToArrayBuffer(url: string): Promise<{ buffer: ArrayBuffer; isDataURL: boolean; dataURL?: string }> {
  if (url.startsWith('data:')) {
    // Data URL — store as string to avoid unnecessary conversion
    return { buffer: new ArrayBuffer(0), isDataURL: true, dataURL: url };
  }
  const resp = await fetch(url);
  const blob = await resp.blob();
  const buffer = await blobToArrayBuffer(blob);
  return { buffer, isDataURL: false };
}

function arrayBufferToBlob(buffer: ArrayBuffer, type: string = 'image/png'): Blob {
  return new Blob([buffer], { type });
}

// ── Settings (localStorage) ──

const SETTINGS_KEY = 'cleanslate_settings';

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // localStorage might be full or disabled
  }
}

export function loadSettings(): AppSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AppSettings;
  } catch {
    return null;
  }
}

// ── Images ──

export async function saveImages(images: ProcessedImage[]): Promise<void> {
  // Only save non-processing images to avoid inconsistent state
  const saveable = images.filter(img =>
    img.status === ProcessStatus.COMPLETED ||
    img.status === ProcessStatus.IDLE ||
    img.status === ProcessStatus.ERROR
  );

  if (saveable.length === 0) {
    await idbDelete('images');
    return;
  }

  const serialized: SerializedImage[] = [];

  for (const img of saveable) {
    const fileBuffer = await blobToArrayBuffer(img.originalFile);

    let resultBuffer: ArrayBuffer | undefined;
    let resultIsDataURL: boolean | undefined;
    let resultDataURL: string | undefined;

    if (img.resultUrl && (img.status === ProcessStatus.COMPLETED)) {
      const result = await urlToArrayBuffer(img.resultUrl);
      resultBuffer = result.buffer;
      resultIsDataURL = result.isDataURL;
      resultDataURL = result.dataURL;
    }

    serialized.push({
      id: img.id,
      fileBuffer,
      fileName: img.originalFile.name,
      fileType: img.originalFile.type || 'image/png',
      relativePath: img.relativePath,
      status: img.status,
      errorMessage: img.errorMessage,
      completedAt: img.completedAt,
      resultBuffer,
      resultIsDataURL,
      resultDataURL,
    });
  }

  await idbSet('images', serialized);
}

export async function loadImages(): Promise<ProcessedImage[]> {
  const serialized = await idbGet<SerializedImage[]>('images');
  if (!serialized || serialized.length === 0) return [];

  const images: ProcessedImage[] = [];
  for (const s of serialized) {
    const file = new File([s.fileBuffer], s.fileName, { type: s.fileType });
    const previewUrl = URL.createObjectURL(file);

    let resultUrl: string | undefined;
    if (s.resultIsDataURL && s.resultDataURL) {
      resultUrl = s.resultDataURL;
    } else if (s.resultBuffer) {
      const blob = arrayBufferToBlob(s.resultBuffer, s.fileType);
      resultUrl = URL.createObjectURL(blob);
    }

    images.push({
      id: s.id,
      originalFile: file,
      previewUrl,
      resultUrl,
      status: s.status as ProcessStatus,
      errorMessage: s.errorMessage,
      relativePath: s.relativePath,
      completedAt: s.completedAt,
    });
  }
  return images;
}

// ── Logos ──

export async function saveLogos(logos: LogoItem[]): Promise<void> {
  if (logos.length === 0) {
    await idbDelete('logos');
    return;
  }

  const serialized: SerializedLogo[] = [];
  for (const logo of logos) {
    const fileBuffer = await blobToArrayBuffer(logo.file);
    serialized.push({
      id: logo.id,
      fileBuffer,
      fileName: logo.file.name,
      fileType: logo.file.type || 'image/png',
      name: logo.name,
    });
  }

  await idbSet('logos', serialized);
}

export async function loadLogos(): Promise<LogoItem[]> {
  const serialized = await idbGet<SerializedLogo[]>('logos');
  if (!serialized || serialized.length === 0) return [];

  return serialized.map(s => {
    const file = new File([s.fileBuffer], s.fileName, { type: s.fileType });
    const url = URL.createObjectURL(file);
    return {
      id: s.id,
      file,
      url,
      name: s.name,
    };
  });
}

// ── Batch Results ──

export async function saveBatchResults(results: BatchResult[]): Promise<void> {
  if (results.length === 0) {
    await idbDelete('batchResults');
    return;
  }

  const serialized: SerializedBatchResult[] = [];
  for (const r of results) {
    let resultBuffer: ArrayBuffer | undefined;
    let resultIsDataURL: boolean | undefined;
    let resultDataURL: string | undefined;

    if (r.resultUrl && r.status === ProcessStatus.COMPLETED) {
      const result = await urlToArrayBuffer(r.resultUrl);
      resultBuffer = result.buffer;
      resultIsDataURL = result.isDataURL;
      resultDataURL = result.dataURL;
    }

    serialized.push({
      id: r.id,
      logoId: r.logoId,
      logoName: r.logoName,
      imageId: r.imageId,
      imageName: r.imageName,
      relativePath: r.relativePath,
      resultBuffer,
      resultIsDataURL,
      resultDataURL,
      status: r.status,
      errorMessage: r.errorMessage,
    });
  }

  await idbSet('batchResults', serialized);
}

export async function loadBatchResults(): Promise<BatchResult[]> {
  const serialized = await idbGet<SerializedBatchResult[]>('batchResults');
  if (!serialized || serialized.length === 0) return [];

  return serialized.map(s => {
    let resultUrl: string | undefined;
    if (s.resultIsDataURL && s.resultDataURL) {
      resultUrl = s.resultDataURL;
    } else if (s.resultBuffer) {
      const blob = arrayBufferToBlob(s.resultBuffer);
      resultUrl = URL.createObjectURL(blob);
    }

    return {
      id: s.id,
      logoId: s.logoId,
      logoName: s.logoName,
      imageId: s.imageId,
      imageName: s.imageName,
      relativePath: s.relativePath,
      resultUrl,
      status: s.status as ProcessStatus,
      errorMessage: s.errorMessage,
    };
  });
}

// ── Sliced Results ──

export async function saveSlicedResults(results: { sourceImageId: string; sourceFileName: string; pieces: SlicedPiece[]; isSlicing: boolean; cropNodes?: number[]; sourceImageUrl?: string }[]): Promise<void> {
  if (results.length === 0) {
    await idbDelete('slicedResults');
    return;
  }

  const serialized: SerializedSliceResult[] = [];
  for (const r of results) {
    const pieces: SerializedSlicePiece[] = [];
    for (const p of r.pieces) {
      const { buffer } = await urlToArrayBuffer(p.url);
      pieces.push({
        id: p.id,
        buffer,
        width: p.width,
        height: p.height,
        index: p.index,
      });
    }
    serialized.push({
      sourceImageId: r.sourceImageId,
      sourceFileName: r.sourceFileName,
      pieces,
      cropNodes: r.cropNodes,
      sourceImageUrl: r.sourceImageUrl,
    });
  }

  await idbSet('slicedResults', serialized);
}

export async function loadSlicedResults(): Promise<{ sourceImageId: string; sourceFileName: string; pieces: SlicedPiece[]; isSlicing: boolean; cropNodes?: number[]; sourceImageUrl?: string }[]> {
  const serialized = await idbGet<SerializedSliceResult[]>('slicedResults');
  if (!serialized || serialized.length === 0) return [];

  return serialized.map(s => ({
    sourceImageId: s.sourceImageId,
    sourceFileName: s.sourceFileName,
    pieces: s.pieces.map(p => {
      const blob = arrayBufferToBlob(p.buffer);
      return {
        id: p.id,
        url: URL.createObjectURL(blob),
        width: p.width,
        height: p.height,
        index: p.index,
      };
    }),
    isSlicing: false,
    cropNodes: s.cropNodes,
    sourceImageUrl: s.sourceImageUrl,
  }));
}

// ── Clear all persisted data ──

export async function clearAllStorageData(): Promise<void> {
  localStorage.removeItem(SETTINGS_KEY);
  await idbDelete('images');
  await idbDelete('logos');
  await idbDelete('batchResults');
  await idbDelete('slicedResults');
}
