'use client';

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Upload, Image as ImageIcon, Wand2, Download, Trash2, Layers, AlertCircle, Play, Stamp, Package, Key, Zap, Crown, Crop as CropIcon, CheckSquare, Square, ChevronDown, Maximize, FolderOpen, ChevronRight, Folder, Film } from 'lucide-react';
import 'react-image-crop/dist/ReactCrop.css';

import { ProcessedImage, ProcessStatus, LogoSettings, ProcessingMode, AiModel, SlicedResult, SlicedPiece, LogoItem, BatchResult, FolderNode } from '@/lib/original/types';
import { removeTextFromImage } from '@/lib/original/services/geminiService';
import { applyLogoToImage, getImageDimensions, applyGlobalCrop, loadElementImage } from '@/lib/original/services/canvasService';
import { LogoControls } from '@/lib/original/components/LogoControls';
import { CropModal } from '@/lib/original/components/CropModal';
import { CustomSliceModal } from '@/lib/original/components/CustomSliceModal';
import { DetailSlicePreview } from '@/lib/original/components/DetailSlicePreview';
import { sliceImage } from '@/lib/original/services/sliceService';
import { saveSettings, loadSettings, saveImages, loadImages, saveLogos, loadLogos, saveBatchResults, loadBatchResults, saveSlicedResults, loadSlicedResults, clearAllStorageData } from '@/lib/original/services/storageService';
import { VideoComposer } from '@/components/VideoComposer';

// JSZip lazy-loaded on demand to reduce page load memory pressure
const MAX_ZIP_ITEMS = 200;
const MAX_ZIP_TOTAL_BYTES = 800 * 1024 * 1024; // 800 MB safety cap

async function downloadZip(files: { path: string; data: Blob }[], zipFileName: string): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  for (const f of files) zip.file(f.path, f.data);
  const blob = await zip.generateAsync({ type: 'blob', streamFiles: true });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = zipFileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function generateZipSafe(
  files: { path: string; data: Blob }[],
  zipFileName: string,
): Promise<void> {
  if (files.length === 0) return;

  // Estimate total size (uncompressed) — rough check
  let totalBytes = 0;
  for (const f of files) totalBytes += f.data.size;

  // If within limits, generate a single ZIP
  if (files.length <= MAX_ZIP_ITEMS && totalBytes <= MAX_ZIP_TOTAL_BYTES) {
    await downloadZip(files, zipFileName);
    return;
  }

  // Chunk into multiple ZIPs to avoid OOM while still packaging everything
  const baseName = zipFileName.replace(/\.zip$/i, '');
  const chunks: { path: string; data: Blob }[][] = [];
  let currentChunk: { path: string; data: Blob }[] = [];
  let currentBytes = 0;

  for (const f of files) {
    // Start a new chunk if adding this file would exceed limits
    if (
      (currentChunk.length >= MAX_ZIP_ITEMS || currentBytes + f.data.size > MAX_ZIP_TOTAL_BYTES) &&
      currentChunk.length > 0
    ) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentBytes = 0;
    }
    currentChunk.push(f);
    currentBytes += f.data.size;
  }
  if (currentChunk.length > 0) chunks.push(currentChunk);

  const paddedLen = String(chunks.length).length;
  for (let i = 0; i < chunks.length; i++) {
    const suffix = chunks.length === 1 ? '' : `_part${String(i + 1).padStart(paddedLen, '0')}`;
    await downloadZip(chunks[i], `${baseName}${suffix}.zip`);
    // Small delay between ZIP downloads to avoid browser throttling
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 200));
  }
}

const DEFAULT_LOGO_SETTINGS: LogoSettings = {
  x: 5,
  y: 5,
  scale: 20,
  opacity: 1,
};

// Helper: find a FolderNode by path in the tree
function nodeMapGet(root: FolderNode, path: string): FolderNode | null {
  if (!path) return root;
  const parts = path.split('/');
  let current = root;
  for (const part of parts) {
    const child = current.children.find(c => c.name === part);
    if (!child) return null;
    current = child;
  }
  return current;
}

export default function Home() {
  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<'image' | 'video'>('image');

  // ── Original App state ──
  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [logoItems, setLogoItems] = useState<LogoItem[]>([]);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [logoSettings, setLogoSettings] = useState<LogoSettings>(DEFAULT_LOGO_SETTINGS);
  const [mode, setMode] = useState<ProcessingMode>('add-logo');
  const [aiModel, setAiModel] = useState<AiModel>('gemini-2.5-flash-image');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [croppingImageId, setCroppingImageId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Batch Crop Settings
  const [enableBatchCrop, setEnableBatchCrop] = useState(false);
  const [batchCropAspect, setBatchCropAspect] = useState<number | null>(1);
  const [batchCropWidth, setBatchCropWidth] = useState<number>(1080);
  const [batchCropHeight, setBatchCropHeight] = useState<number>(1080);

  // Detail Page Crop Settings
  const [detailCropRatio, setDetailCropRatio] = useState<'1:1' | '3:4' | 'custom' | 'manual'>('1:1');
  const [detailCropWidthPx, setDetailCropWidthPx] = useState<number>(800);
  const [detailCropHeightPx, setDetailCropHeightPx] = useState<number>(800);
  const [customCropImageId, setCustomCropImageId] = useState<string | null>(null);

  // Detail Slice State
  const [slicedResults, setSlicedResults] = useState<SlicedResult[]>([]);
  const [sliceProgress, setSliceProgress] = useState<{ current: number; total: number } | null>(null);

  // Batch results navigation state
  const [batchSelectedLogoId, setBatchSelectedLogoId] = useState<string | null>(null);
  const [batchSelectedFolderPath, setBatchSelectedFolderPath] = useState<string | null>(null);

  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [apiKeySaved, setApiKeySaved] = useState(false);

  // Pending images to import into video composer
  const [pendingVideoImport, setPendingVideoImport] = useState<{ url: string; name: string; relativePath: string }[] | null>(null);

  // Global progress tracking
  const [globalProgress, setGlobalProgress] = useState<{ current: number; total: number; startTime: number } | null>(null);

  // Refs to always access latest state in async processing
  const imagesRef = useRef<ProcessedImage[]>(images);
  const isProcessingRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  // Collapsible sections state - all collapsed by default
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set(['model', 'api', 'mode', 'crop', 'logo', 'detailCrop']));

  const toggleSection = (section: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const isSectionCollapsed = (section: string) => collapsedSections.has(section);

  // Folder navigation state
  const [currentFolderPath, setCurrentFolderPath] = useState<string | null>(null);

  // ── State Persistence: restore on mount, save on changes ──
  const [isRestoring, setIsRestoring] = useState(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore state from IndexedDB + localStorage on mount
  useEffect(() => {
    const restore = async () => {
      try {
        const settings = loadSettings();
        if (settings) {
          setMode(settings.mode);
          setAiModel(settings.aiModel);
          setLogoSettings(settings.logoSettings);
          setEnableBatchCrop(settings.enableBatchCrop);
          setBatchCropAspect(settings.batchCropAspect);
          setBatchCropWidth(settings.batchCropWidth);
          setBatchCropHeight(settings.batchCropHeight);
          setDetailCropRatio(settings.detailCropRatio);
          setDetailCropWidthPx(settings.detailCropWidthPx);
          setDetailCropHeightPx(settings.detailCropHeightPx);
          setCurrentFolderPath(settings.currentFolderPath);
          if (settings.collapsedSections) {
            setCollapsedSections(new Set(settings.collapsedSections));
          }
        }

        const [savedImages, savedLogos, savedBatchResults, savedSlicedResults] = await Promise.all([
          loadImages(),
          loadLogos(),
          loadBatchResults(),
          loadSlicedResults(),
        ]);

        if (savedImages.length > 0) setImages(savedImages);
        if (savedLogos.length > 0) setLogoItems(savedLogos);
        if (savedBatchResults.length > 0) setBatchResults(savedBatchResults);
        if (savedSlicedResults.length > 0) {
          setSlicedResults(savedSlicedResults.map(r => ({ ...r, isSlicing: false })));
        }
      } catch (err) {
        console.error('Failed to restore state:', err);
      } finally {
        setIsRestoring(false);
      }
    };
    restore();
  }, []);

  // Debounced save — triggers 1s after last state change
  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (isProcessingRef.current) return;
      try {
        saveSettings({
          mode, aiModel, logoSettings,
          enableBatchCrop, batchCropAspect, batchCropWidth, batchCropHeight,
          detailCropRatio, detailCropWidthPx, detailCropHeightPx,
          currentFolderPath,
          collapsedSections: Array.from(collapsedSections),
        });
        await Promise.all([
          saveImages(imagesRef.current),
          saveLogos(logoItems),
          saveBatchResults(batchResults),
          saveSlicedResults(slicedResults),
        ]);
      } catch (err) {
        console.error('Failed to save state:', err);
      }
    }, 1000);
  }, [mode, aiModel, logoSettings, enableBatchCrop, batchCropAspect, batchCropWidth, batchCropHeight, detailCropRatio, detailCropWidthPx, detailCropHeightPx, currentFolderPath, collapsedSections, logoItems, batchResults, slicedResults]);

  // Schedule save whenever key state changes
  useEffect(() => {
    if (!isRestoring) scheduleSave();
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [isRestoring, scheduleSave]);

  // Save on page hide/unload
  useEffect(() => {
    const handleHide = async () => {
      if (isProcessingRef.current) return;
      try {
        saveSettings({
          mode, aiModel, logoSettings,
          enableBatchCrop, batchCropAspect, batchCropWidth, batchCropHeight,
          detailCropRatio, detailCropWidthPx, detailCropHeightPx,
          currentFolderPath,
          collapsedSections: Array.from(collapsedSections),
        });
        saveImages(imagesRef.current);
        saveLogos(logoItems);
        saveBatchResults(batchResults);
        saveSlicedResults(slicedResults);
      } catch { /* best effort */ }
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') handleHide();
    });
    window.addEventListener('pagehide', handleHide as EventListener);
    return () => {
      document.removeEventListener('visibilitychange', handleHide as EventListener);
      window.removeEventListener('pagehide', handleHide as EventListener);
    };
  }, [mode, aiModel, logoSettings, enableBatchCrop, batchCropAspect, batchCropWidth, batchCropHeight, detailCropRatio, detailCropWidthPx, detailCropHeightPx, currentFolderPath, collapsedSections, logoItems, batchResults, slicedResults]);

  // Build folder tree from images
  const folderTree = useMemo(() => {
    const root: FolderNode = { name: '根目录', fullPath: '', imageCount: 0, directImageCount: 0, children: [] };
    const nodeMap = new Map<string, FolderNode>();
    nodeMap.set('', root);

    for (const img of images) {
      const path = img.relativePath || '';
      if (!path) {
        root.directImageCount++;
        root.imageCount++;
        if (!root.previewUrl) root.previewUrl = img.previewUrl;
        continue;
      }

      const parts = path.split('/');
      let currentPath = '';
      for (let i = 0; i < parts.length; i++) {
        const parentPath = currentPath;
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];

        if (!nodeMap.has(currentPath)) {
          const node: FolderNode = {
            name: parts[i],
            fullPath: currentPath,
            imageCount: 0,
            directImageCount: 0,
            children: [],
            previewUrl: i === parts.length - 1 ? img.previewUrl : undefined,
          };
          nodeMap.set(currentPath, node);
          const parent = nodeMap.get(parentPath);
          if (parent) parent.children.push(node);
        }

        const node = nodeMap.get(currentPath)!;
        node.imageCount++;
        if (i === parts.length - 1) {
          node.directImageCount++;
          if (!node.previewUrl) node.previewUrl = img.previewUrl;
        }
      }
    }

    return root;
  }, [images]);

  // Get subfolders for current path
  const currentFolderNode = useMemo(() => {
    if (!currentFolderPath) return folderTree;
    return nodeMapGet(folderTree, currentFolderPath);
  }, [currentFolderPath, folderTree]);

  // Get images for current folder view
  const currentFolderImages = useMemo(() => {
    if (!currentFolderPath) {
      return images.filter(img => !img.relativePath);
    }
    return images.filter(img => img.relativePath === currentFolderPath);
  }, [images, currentFolderPath]);

  // Breadcrumb path segments
  const breadcrumbSegments = useMemo(() => {
    if (!currentFolderPath) return [];
    return currentFolderPath.split('/').map((name, idx, arr) => ({
      name,
      fullPath: arr.slice(0, idx + 1).join('/'),
    }));
  }, [currentFolderPath]);

  // Navigate to a folder
  const navigateToFolder = (path: string | null) => {
    setCurrentFolderPath(path);
  };

  // Check for API Key on mount
  useEffect(() => {
    const checkKey = async () => {
        if ((window as any).aistudio && (window as any).aistudio.hasSelectedApiKey) {
            const has = await (window as any).aistudio.hasSelectedApiKey();
            setHasApiKey(has);
        } else {
            const savedKey = localStorage.getItem('gemini_api_key');
            if (savedKey) {
                setApiKeyInput(savedKey);
                setApiKeySaved(true);
                setHasApiKey(true);
            } else {
                setHasApiKey(true);
            }
        }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    if ((window as any).aistudio && (window as any).aistudio.openSelectKey) {
        await (window as any).aistudio.openSelectKey();
        setHasApiKey(true);
    }
  };

  const handleSaveApiKey = () => {
    const trimmed = apiKeyInput.trim();
    if (trimmed) {
        localStorage.setItem('gemini_api_key', trimmed);
        setApiKeySaved(true);
        setHasApiKey(true);
    }
  };

  const handleRemoveApiKey = () => {
    localStorage.removeItem('gemini_api_key');
    setApiKeyInput('');
    setApiKeySaved(false);
  };

  // Calculate ETA string from global progress
  const getEtaString = (progress: { current: number; total: number; startTime: number }): string => {
    if (progress.current === 0 || progress.current >= progress.total) return '';
    const elapsed = Date.now() - progress.startTime;
    const avgTimePerImage = elapsed / progress.current;
    const remaining = (progress.total - progress.current) * avgTimePerImage;
    const seconds = Math.ceil(remaining / 1000);
    if (seconds < 60) return `约 ${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (minutes < 60) return `约 ${minutes} 分 ${secs} 秒`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `约 ${hours} 小时 ${mins} 分`;
  };

  // Calculate avg time per image string
  const getAvgTimeString = (progress: { current: number; total: number; startTime: number }): string => {
    if (progress.current === 0) return '';
    const elapsed = Date.now() - progress.startTime;
    const avgMs = elapsed / progress.current;
    if (avgMs < 1000) return `${Math.round(avgMs)} ms/张`;
    return `${(avgMs / 1000).toFixed(1)} 秒/张`;
  };

  // Helper to create a unique ID
  const generateId = () => Math.random().toString(36).substring(2, 11);

  // Valid image extensions
  const VALID_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

  const isValidImageFile = (file: File): boolean => {
    if (file.type.startsWith('image/')) return true;
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    return VALID_IMAGE_EXTENSIONS.has(ext);
  };

  const isHiddenFile = (name: string): boolean => {
    return name.startsWith('.') || name === '__MACOSX' || name.includes('/__MACOSX') || name.includes('\\__MACOSX');
  };

  // Extract relative path from File's webkitRelativePath
  const getRelativePath = (file: File): string => {
    const rel = (file as any).webkitRelativePath as string;
    if (rel && rel.includes('/')) {
      return rel.substring(0, rel.lastIndexOf('/'));
    }
    return '';
  };

  // Unified File Handler
  const handleFiles = async (files: FileList | File[]) => {
    const allFiles = Array.from(files);
    const validFiles = allFiles.filter(
      f => isValidImageFile(f) && !isHiddenFile(f.name)
    );

    if (validFiles.length === 0) return;

    const CHUNK_SIZE = 50;
    const chunks: File[][] = [];
    for (let i = 0; i < validFiles.length; i += CHUNK_SIZE) {
      chunks.push(validFiles.slice(i, i + CHUNK_SIZE));
    }

    for (const chunk of chunks) {
      const newImages: ProcessedImage[] = chunk.map((file) => ({
        id: generateId(),
        originalFile: file,
        previewUrl: URL.createObjectURL(file),
        status: ProcessStatus.IDLE,
        relativePath: getRelativePath(file) || undefined,
      }));
      setImages((prev) => [...prev, ...newImages]);
      await new Promise(r => setTimeout(r, 0));
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleFolderUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
      e.target.value = '';
    }
  };

  // Drag and Drop Handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingOver) setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingOver(false);
  };

  const readAllDirectoryEntries = async (dirReader: any): Promise<any[]> => {
    const entries: any[] = [];
    let readBatch: any[];
    do {
      readBatch = await new Promise<any[]>((resolve, reject) => {
        dirReader.readEntries((results: any[]) => resolve(results), (error: any) => reject(error));
      });
      entries.push(...readBatch);
    } while (readBatch.length > 0);
    return entries;
  };

  const traverseDirectoryEntry = async (entry: any, path: string = ''): Promise<File[]> => {
    const collected: File[] = [];

    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        entry.file((f: File) => resolve(f), (err: any) => reject(err));
      });
      Object.defineProperty(file, 'webkitRelativePath', {
        value: path ? `${path}/${file.name}` : file.name,
        writable: false,
      });
      collected.push(file);
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const entries = await readAllDirectoryEntries(dirReader);
      const currentPath = path ? `${path}/${entry.name}` : entry.name;
      for (const child of entries) {
        const childFiles = await traverseDirectoryEntry(child, currentPath);
        collected.push(...childFiles);
      }
    }

    return collected;
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const items = e.dataTransfer.items;
    if (!items || items.length === 0) {
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleFiles(e.dataTransfer.files);
      }
      return;
    }

    const allFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const entry = (item as any).webkitGetAsEntry?.() || (item as any).getAsEntry?.();
      if (entry) {
        const files = await traverseDirectoryEntry(entry);
        allFiles.push(...files);
      } else {
        const file = item.getAsFile();
        if (file) allFiles.push(file);
      }
    }

    if (allFiles.length > 0) {
      handleFiles(allFiles);
    }
  };

  const handleLogosUpload = (files: File[]) => {
    const imageFiles = files.filter(f => isValidImageFile(f) && !isHiddenFile(f.name));
    const newItems: LogoItem[] = imageFiles.map(file => ({
      id: generateId(),
      file,
      url: URL.createObjectURL(file),
      name: file.name.substring(0, file.name.lastIndexOf('.')) || file.name,
    }));
    setLogoItems(prev => [...prev, ...newItems]);
  };

  const handleLogoRemove = (id: string) => {
    setLogoItems(prev => {
      const item = prev.find(i => i.id === id);
      if (item) URL.revokeObjectURL(item.url);
      return prev.filter(i => i.id !== id);
    });
  };

  const handleLogoReorder = (fromIndex: number, toIndex: number) => {
    setLogoItems(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleDelete = (id: string) => {
    setImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        if (target.resultUrl) URL.revokeObjectURL(target.resultUrl);
      }
      return prev.filter((img) => img.id !== id);
    });
  };

  const updateImageById = useCallback((id: string, updates: Partial<ProcessedImage>) => {
    setImages(prev => prev.map(img => img.id === id ? { ...img, ...updates } : img));
  }, []);

  const getCurrentImage = useCallback((id: string): ProcessedImage | undefined => {
    return imagesRef.current.find(img => img.id === id);
  }, []);

  const updateBatchResult = useCallback((id: string, updates: Partial<BatchResult>) => {
    setBatchResults(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  }, []);

  // Main Processing Logic — Multi-Logo Batch
  const processBatch = async () => {
    if (images.length === 0) return;

    const shouldAddLogo = (mode === 'add-logo' || mode === 'both');
    if (shouldAddLogo && logoItems.length === 0) {
      alert('请先上传至少一个 Logo');
      return;
    }

    if (mode === 'crop-only' && !enableBatchCrop) {
      alert('仅裁剪模式需要启用批量裁剪参数');
      return;
    }

    setIsProcessing(true);
    isProcessingRef.current = true;
    setBatchSelectedLogoId(null);
    setBatchSelectedFolderPath(null);

    batchResults.forEach(r => { if (r.resultUrl && r.resultUrl.startsWith('blob:')) URL.revokeObjectURL(r.resultUrl); });

    const imageIds = images.map(img => img.id);
    const preprocessedMap = new Map<string, { url: string; dims: { width: number; height: number } }>();

    setGlobalProgress({ current: 0, total: imageIds.length, startTime: Date.now() });

    for (const imageId of imageIds) {
      if (!isProcessingRef.current) break;

      const currentImg = getCurrentImage(imageId);
      if (!currentImg) continue;

      updateImageById(imageId, {
        status: ProcessStatus.PROCESSING,
        errorMessage: undefined,
        progressValue: 0,
        progressMessage: '准备处理...',
      });
      await new Promise(r => setTimeout(r, 0));

      try {
        let currentUrl = currentImg.previewUrl;
        let dims = await getImageDimensions(currentUrl);

        if (enableBatchCrop) {
          updateImageById(imageId, { progressMessage: '正在裁剪尺寸...', progressValue: 10 });
          await new Promise(r => setTimeout(r, 0));
          try {
            const cropResult = await applyGlobalCrop(
              currentUrl,
              batchCropAspect,
              batchCropAspect === null ? batchCropWidth : undefined,
              batchCropAspect === null ? batchCropHeight : undefined
            );
            currentUrl = cropResult.url;
            dims = cropResult.dims;
          } catch (err: any) {
            throw new Error(`全局裁剪失败: ${err.message}`);
          }
        }

        if (mode === 'both') {
          updateImageById(imageId, { progressMessage: 'AI 正在智能去字...', progressValue: 30 });
          await new Promise(r => setTimeout(r, 0));
          try {
            let fileToProcess = currentImg.originalFile;
            if (currentUrl !== currentImg.previewUrl) {
              const res = await fetch(currentUrl);
              const blob = await res.blob();
              fileToProcess = new File([blob], currentImg.originalFile.name, { type: 'image/png' });
            }
            const aiResultBase64 = await removeTextFromImage(fileToProcess, aiModel);
            currentUrl = aiResultBase64;
          } catch (err: any) {
            throw new Error(`AI 处理失败: ${err.message || '未知错误'}`);
          }
        }

        preprocessedMap.set(imageId, { url: currentUrl, dims });
        const prevImg = getCurrentImage(imageId);
        if (prevImg?.resultUrl && prevImg.resultUrl.startsWith('blob:')) {
          URL.revokeObjectURL(prevImg.resultUrl);
        }
        updateImageById(imageId, {
          resultUrl: currentUrl,
          status: ProcessStatus.COMPLETED,
          progressValue: shouldAddLogo ? 50 : 100,
          progressMessage: shouldAddLogo ? '预处理完成，正在合成 Logo...' : '处理完成',
          completedAt: Date.now(),
        });

        setGlobalProgress(prev => prev ? { ...prev, current: prev.current + 1 } : null);
      } catch (error: any) {
        updateImageById(imageId, {
          status: ProcessStatus.ERROR,
          errorMessage: error.message,
          progressValue: 0,
          progressMessage: '处理出错',
          completedAt: Date.now(),
        });
        setGlobalProgress(prev => prev ? { ...prev, current: prev.current + 1 } : null);
      }
      await new Promise(r => setTimeout(r, 0));
    }

    // Phase 2: Apply each Logo to preprocessed images
    if (shouldAddLogo && logoItems.length > 0 && preprocessedMap.size > 0) {
      const initialResults: BatchResult[] = [];
      for (const logo of logoItems) {
        for (const imageId of imageIds) {
          if (!preprocessedMap.has(imageId)) continue;
          const img = getCurrentImage(imageId);
          if (!img) continue;
          initialResults.push({
            id: generateId(),
            logoId: logo.id,
            logoName: logo.name,
            imageId,
            imageName: img.originalFile.name,
            relativePath: img.relativePath,
            status: ProcessStatus.IDLE,
          });
        }
      }
      setBatchResults(initialResults);

      const resultLookup = new Map<string, BatchResult>();
      for (const r of initialResults) resultLookup.set(`${r.logoId}__${r.imageId}`, r);

      const totalResults = initialResults.length;
      let completedCount = 0;

      const logoImageCache = new Map<string, HTMLImageElement>();
      await Promise.all(logoItems.map(async (logo) => {
        try {
          const img = await loadElementImage(logo.url);
          logoImageCache.set(logo.id, img);
        } catch { /* ignore */ }
      }));

      const CONCURRENT_BATCH = 8;

      for (const logo of logoItems) {
        if (!isProcessingRef.current) break;

        const validImageIds = imageIds.filter(id => preprocessedMap.has(id));
        for (let i = 0; i < validImageIds.length; i += CONCURRENT_BATCH) {
          if (!isProcessingRef.current) break;
          const batchIds = validImageIds.slice(i, i + CONCURRENT_BATCH);

          await Promise.all(batchIds.map(async (imageId) => {
            const preprocessed = preprocessedMap.get(imageId);
            if (!preprocessed) return;

            const resultEntry = resultLookup.get(`${logo.id}__${imageId}`);
            if (!resultEntry) return;

            completedCount++;
            const progress = Math.round((completedCount / totalResults) * 100);

            updateBatchResult(resultEntry.id, {
              status: ProcessStatus.PROCESSING,
              progressMessage: `正在合成 ${logo.name}...`,
              progressValue: progress,
            });

            try {
              const resultUrl = await applyLogoToImage(
                preprocessed.url,
                logo.url,
                logoSettings,
                preprocessed.dims,
                logoImageCache.get(logo.id)
              );
              updateBatchResult(resultEntry.id, {
                resultUrl,
                status: ProcessStatus.COMPLETED,
                progressValue: 100,
                progressMessage: '完成',
              });
            } catch (error: any) {
              updateBatchResult(resultEntry.id, {
                status: ProcessStatus.ERROR,
                errorMessage: error.message,
              });
            }
          }));
        }
      }
    }

    setIsProcessing(false);
    isProcessingRef.current = false;
    setGlobalProgress(null);
  };

  const downloadImage = (img: ProcessedImage) => {
    if (!img.resultUrl) return;
    const link = document.createElement('a');
    link.href = img.resultUrl;
    link.download = `processed_${img.originalFile.name.split('.')[0]}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadSelected = async () => {
    const imagesToDownload = selectedCompletedImages.length > 0
      ? selectedCompletedImages
      : completedImages;
    const downloadable = imagesToDownload.filter(img => img.resultUrl);
    if (downloadable.length === 0) return;

    if (downloadable.length === 1) {
      downloadImage(downloadable[0]);
      return;
    }

    setIsZipping(true);
    try {
      const usedPaths = new Set<string>();
      const zipFiles: { path: string; data: Blob }[] = [];

      const promises = downloadable.map(async (img) => {
        if (!img.resultUrl) return;
        const response = await fetch(img.resultUrl);
        const blob = await response.blob();

        let ext = 'png';
        if (blob.type === 'image/jpeg') ext = 'jpg';
        else if (blob.type === 'image/webp') ext = 'webp';

        const originalName = img.originalFile.name;
        const nameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;

        const baseName = `${nameWithoutExt}.${ext}`;
        const relDir = img.relativePath || '';
        const fullPath = relDir ? `${relDir}/${baseName}` : baseName;

        let finalPath = fullPath;
        let counter = 1;
        while (usedPaths.has(finalPath)) {
          finalPath = relDir ? `${relDir}/${nameWithoutExt}_${counter}.${ext}` : `${nameWithoutExt}_${counter}.${ext}`;
          counter++;
        }
        usedPaths.add(finalPath);

        zipFiles.push({ path: finalPath, data: blob });
      });

      await Promise.all(promises);
      zipFiles.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
      await generateZipSafe(zipFiles, `cleanslate_batch.zip`);
    } catch (error) {
      console.error("Zip generation failed", error);
      alert("打包下载失败，请重试");
    } finally {
      setIsZipping(false);
    }
  };

  const downloadBatchResult = (result: BatchResult) => {
    if (!result.resultUrl) return;
    const link = document.createElement('a');
    link.href = result.resultUrl;
    const imageNameWithoutExt = result.imageName.substring(0, result.imageName.lastIndexOf('.')) || result.imageName;
    link.download = `${imageNameWithoutExt}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadBatchFolderResults = async (logoId: string, folderPath: string | null) => {
    const group = batchResultsByLogo.get(logoId);
    if (!group) return;

    let completedResults = group.results.filter(r => r.status === ProcessStatus.COMPLETED && r.resultUrl);

    if (folderPath !== null) {
      completedResults = completedResults.filter(r => {
        if (!folderPath) return !r.relativePath;
        return r.relativePath === folderPath || r.relativePath?.startsWith(folderPath + '/');
      });
    }

    if (completedResults.length === 0) {
      alert('没有可下载的结果');
      return;
    }

    if (completedResults.length === 1) {
      downloadBatchResult(completedResults[0]);
      return;
    }

    setIsZipping(true);
    try {
      const usedPaths = new Set<string>();
      const zipFiles: { path: string; data: Blob }[] = [];

      await Promise.all(completedResults.map(async (result) => {
        if (!result.resultUrl) return;
        const response = await fetch(result.resultUrl);
        const blob = await response.blob();
        const imageNameWithoutExt = result.imageName.substring(0, result.imageName.lastIndexOf('.')) || result.imageName;
        const baseName = `${imageNameWithoutExt}.png`;

        let relDir = '';
        if (folderPath === null) {
          relDir = result.relativePath || '';
        } else if (folderPath && result.relativePath) {
          if (result.relativePath.startsWith(folderPath + '/')) {
            relDir = result.relativePath.substring(folderPath.length + 1);
          }
        }

        const fullPath = relDir ? `${relDir}/${baseName}` : baseName;
        let finalPath = fullPath;
        let counter = 1;
        while (usedPaths.has(finalPath)) {
          finalPath = relDir ? `${relDir}/${imageNameWithoutExt}_${counter}.png` : `${imageNameWithoutExt}_${counter}.png`;
          counter++;
        }
        usedPaths.add(finalPath);
        zipFiles.push({ path: finalPath, data: blob });
      }));

      const logoName = group.results[0]?.logoName || 'unknown';
      zipFiles.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
      await generateZipSafe(zipFiles, `${logoName}.zip`);
    } catch (error) {
      console.error("Zip generation failed", error);
      alert("打包下载失败，请重试");
    } finally {
      setIsZipping(false);
    }
  };

  const downloadFolderImages = async (folderPath: string, folderName: string) => {
    const folderImages = images.filter(img => {
      if (!img.resultUrl || img.status !== ProcessStatus.COMPLETED) return false;
      if (!folderPath) return !img.relativePath;
      return img.relativePath === folderPath || img.relativePath?.startsWith(folderPath + '/');
    });

    if (folderImages.length === 0) {
      alert('该文件夹中没有已处理的图片');
      return;
    }

    if (folderImages.length === 1) {
      downloadImage(folderImages[0]);
      return;
    }

    setIsZipping(true);
    try {
      const usedPaths = new Set<string>();
      const zipFiles: { path: string; data: Blob }[] = [];

      await Promise.all(folderImages.map(async (img) => {
        if (!img.resultUrl) return;
        const response = await fetch(img.resultUrl);
        const blob = await response.blob();

        let ext = 'png';
        if (blob.type === 'image/jpeg') ext = 'jpg';
        else if (blob.type === 'image/webp') ext = 'webp';

        const originalName = img.originalFile.name;
        const nameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.')) || originalName;
        const baseName = `${nameWithoutExt}.${ext}`;

        let relDir = '';
        if (folderPath && img.relativePath) {
          if (img.relativePath.startsWith(folderPath + '/')) {
            relDir = img.relativePath.substring(folderPath.length + 1);
          } else if (img.relativePath === folderPath) {
            relDir = '';
          } else {
            relDir = img.relativePath;
          }
        } else if (!folderPath && img.relativePath) {
          relDir = img.relativePath;
        }

        const fullPath = relDir ? `${relDir}/${baseName}` : baseName;

        let finalPath = fullPath;
        let counter = 1;
        while (usedPaths.has(finalPath)) {
          finalPath = relDir ? `${relDir}/${nameWithoutExt}_${counter}.${ext}` : `${nameWithoutExt}_${counter}.${ext}`;
          counter++;
        }
        usedPaths.add(finalPath);
        zipFiles.push({ path: finalPath, data: blob });
      }));

      zipFiles.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
      await generateZipSafe(zipFiles, `${folderName}.zip`);
    } catch (error) {
      console.error('Folder zip failed', error);
    } finally {
      setIsZipping(false);
    }
  };

  const handleDownloadAllBatchResults = async () => {
    const completed = batchResults.filter(r => r.status === ProcessStatus.COMPLETED && r.resultUrl);
    if (completed.length === 0) return;

    if (completed.length === 1) {
      downloadBatchResult(completed[0]);
      return;
    }

    setIsZipping(true);
    try {
      const usedPaths = new Set<string>();
      const zipFiles: { path: string; data: Blob }[] = [];

      await Promise.all(completed.map(async (result) => {
        if (!result.resultUrl) return;
        const response = await fetch(result.resultUrl);
        const blob = await response.blob();
        const imageNameWithoutExt = result.imageName.substring(0, result.imageName.lastIndexOf('.')) || result.imageName;
        const baseName = `${imageNameWithoutExt}.png`;

        const relDir = result.relativePath || '';
        const fullPath = relDir ? `${result.logoName}/${relDir}/${baseName}` : `${result.logoName}/${baseName}`;

        let finalPath = fullPath;
        let counter = 1;
        while (usedPaths.has(finalPath)) {
          finalPath = relDir
            ? `${result.logoName}/${relDir}/${imageNameWithoutExt}_${counter}.png`
            : `${result.logoName}/${imageNameWithoutExt}_${counter}.png`;
          counter++;
        }
        usedPaths.add(finalPath);
        zipFiles.push({ path: finalPath, data: blob });
      }));

      zipFiles.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
      await generateZipSafe(zipFiles, `batch_logo_results.zip`);
    } catch (error) {
      console.error("Zip generation failed", error);
      alert("打包下载失败，请重试");
    } finally {
      setIsZipping(false);
    }
  };

  const clearAll = () => {
    images.forEach(img => {
        URL.revokeObjectURL(img.previewUrl);
        if(img.resultUrl) URL.revokeObjectURL(img.resultUrl);
    });
    slicedResults.forEach(r => r.pieces.forEach(p => URL.revokeObjectURL(p.url)));
    batchResults.forEach(r => { if (r.resultUrl) URL.revokeObjectURL(r.resultUrl); });
    setImages([]);
    logoItems.forEach(item => URL.revokeObjectURL(item.url));
    setLogoItems([]);
    setBatchResults([]);
    setSlicedResults([]);
    setSelectedIds(new Set());
    clearAllStorageData();
  };

  const handleSliceImage = useCallback(async (imageId: string) => {
    const img = imagesRef.current.find(i => i.id === imageId);
    if (!img) return;

    const sourceUrl = img.status === ProcessStatus.COMPLETED && img.resultUrl ? img.resultUrl : img.previewUrl;

    if (detailCropRatio === 'manual') {
      setCustomCropImageId(imageId);
      return;
    }

    setSlicedResults(prev => {
      const existing = prev.find(r => r.sourceImageId === imageId);
      if (existing) return prev;
      return [...prev, {
        sourceImageId: imageId,
        sourceFileName: img.originalFile.name,
        pieces: [],
        isSlicing: true,
      }];
    });
    setSliceProgress({ current: 0, total: 0 });

    try {
      const results = await sliceImage(
        sourceUrl,
        detailCropRatio,
        detailCropWidthPx,
        detailCropHeightPx,
        (current, total) => setSliceProgress({ current, total })
      );

      const pieces: SlicedPiece[] = results.map(r => ({
        id: `${imageId}_slice_${r.index}`,
        url: r.url,
        width: r.width,
        height: r.height,
        index: r.index,
      }));

      setSlicedResults(prev =>
        prev.map(r =>
          r.sourceImageId === imageId
            ? { ...r, pieces, isSlicing: false }
            : r
        )
      );
    } catch (err: any) {
      alert(`切片失败: ${err.message}`);
      setSlicedResults(prev => prev.filter(r => r.sourceImageId !== imageId));
    } finally {
      setSliceProgress(null);
    }
  }, [detailCropRatio, detailCropWidthPx, detailCropHeightPx]);

  const handleCustomSliceCrop = useCallback((imageId: string, pieces: SlicedPiece[], cropNodes: number[]) => {
    const img = imagesRef.current.find(i => i.id === imageId);
    if (!img) return;
    const sourceUrl = img.status === ProcessStatus.COMPLETED && img.resultUrl ? img.resultUrl : img.previewUrl;

    setSlicedResults(prev => {
      const filtered = prev.filter(r => r.sourceImageId !== imageId);
      return [...filtered, {
        sourceImageId: imageId,
        sourceFileName: img.originalFile.name,
        pieces,
        isSlicing: false,
        cropNodes,
        sourceImageUrl: sourceUrl,
      }];
    });
    setCustomCropImageId(null);
  }, []);

  const removeSlicedResult = useCallback((imageId: string) => {
    setSlicedResults(prev => {
      const result = prev.find(r => r.sourceImageId === imageId);
      if (result) {
        result.pieces.forEach(p => URL.revokeObjectURL(p.url));
      }
      return prev.filter(r => r.sourceImageId !== imageId);
    });
  }, []);

  const handleSaveCrop = useCallback((croppedFile: File) => {
    if (!croppingImageId) return;
    
    setImages(prev => prev.map(img => {
      if (img.id === croppingImageId) {
        const newUrl = URL.createObjectURL(croppedFile);
        
        if (img.status === ProcessStatus.COMPLETED && img.resultUrl) {
            URL.revokeObjectURL(img.resultUrl);
            return {
                ...img,
                resultUrl: newUrl,
            };
        } else {
            URL.revokeObjectURL(img.previewUrl);
            return {
                ...img,
                originalFile: croppedFile,
                previewUrl: newUrl,
                status: ProcessStatus.IDLE
            };
        }
      }
      return img;
    }));
    setCroppingImageId(null);
  }, [croppingImageId]);

  const croppingImage = useMemo(() => images.find(img => img.id === croppingImageId), [images, croppingImageId]);

  const customCropImage = useMemo(() => images.find(img => img.id === customCropImageId), [images, customCropImageId]);

  const firstPreviewImage = useMemo(() => {
    return images.length > 0 ? images[0].previewUrl : null;
  }, [images]);

  const hasCompletedImages = images.some(img => img.status === ProcessStatus.COMPLETED);

  const completedImages = useMemo(() => images.filter(img => img.status === ProcessStatus.COMPLETED), [images]);
  const allSelected = completedImages.length > 0 && completedImages.every(img => selectedIds.has(img.id));
  const selectedCompletedImages = useMemo(() => completedImages.filter(img => selectedIds.has(img.id)), [completedImages, selectedIds]);

  const batchResultsByLogo = useMemo(() => {
    const groups = new Map<string, { logo: LogoItem | null; results: BatchResult[] }>();
    for (const result of batchResults) {
      if (!groups.has(result.logoId)) {
        groups.set(result.logoId, { logo: logoItems.find(l => l.id === result.logoId) || null, results: [] });
      }
      groups.get(result.logoId)!.results.push(result);
    }
    return groups;
  }, [batchResults, logoItems]);

  const batchLogoFolderTree = useMemo(() => {
    if (!batchSelectedLogoId) return null;
    const group = batchResultsByLogo.get(batchSelectedLogoId);
    if (!group) return null;

    const root: FolderNode = { name: '根目录', fullPath: '', imageCount: 0, directImageCount: 0, children: [] };
    const nodeMap = new Map<string, FolderNode>();
    nodeMap.set('', root);

    for (const result of group.results) {
      const path = result.relativePath || '';
      if (!path) {
        root.directImageCount++;
        root.imageCount++;
        continue;
      }
      const parts = path.split('/');
      let currentPath = '';
      for (let i = 0; i < parts.length; i++) {
        const parentPath = currentPath;
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
        if (!nodeMap.has(currentPath)) {
          const node: FolderNode = { name: parts[i], fullPath: currentPath, imageCount: 0, directImageCount: 0, children: [] };
          nodeMap.set(currentPath, node);
          const parent = nodeMap.get(parentPath);
          if (parent) parent.children.push(node);
        }
        const node = nodeMap.get(currentPath)!;
        node.imageCount++;
        if (i === parts.length - 1) node.directImageCount++;
      }
    }
    return root;
  }, [batchSelectedLogoId, batchResultsByLogo]);

  const currentBatchResults = useMemo(() => {
    if (!batchSelectedLogoId) return [];
    const group = batchResultsByLogo.get(batchSelectedLogoId);
    if (!group) return [];
    if (!batchSelectedFolderPath) {
      return group.results.filter(r => !r.relativePath);
    }
    return group.results.filter(r => r.relativePath === batchSelectedFolderPath);
  }, [batchSelectedLogoId, batchSelectedFolderPath, batchResultsByLogo]);

  const batchFolderSegments = useMemo(() => {
    if (!batchSelectedFolderPath) return [];
    return batchSelectedFolderPath.split('/').map((name, idx, arr) => ({
      name,
      fullPath: arr.slice(0, idx + 1).join('/'),
    }));
  }, [batchSelectedFolderPath]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(completedImages.map(img => img.id)));
    }
  };

  // ── Render API Key Selection Screen if no key ──
  if (activeTab === 'image' && !hasApiKey) {
    return (
        <div className="h-screen w-full flex items-center justify-center bg-gradient-to-br from-gray-950 via-gray-950 to-indigo-950/30 text-white p-4">
            <div className="bg-gray-900/80 border border-white/[0.08] rounded-2xl p-8 max-w-md w-full shadow-2xl shadow-indigo-500/5 backdrop-blur-xl text-center">
                <div className="w-16 h-16 bg-gradient-to-br from-indigo-900/40 to-purple-900/40 rounded-full flex items-center justify-center mx-auto mb-6 ring-1 ring-indigo-500/20">
                    <Key className="w-8 h-8 text-indigo-400" />
                </div>
                <h2 className="text-2xl font-bold mb-3">需要 API 访问权限</h2>
                <p className="text-gray-400 mb-8 text-sm leading-relaxed">
                    为了使用 CleanSlate AI 的图像处理功能，请连接您的 Google Cloud 项目 API 密钥。<br/>
                    您可以前往 <a href="https://aistudio.google.com/" target="_blank" className="text-indigo-400 underline">Google AI Studio</a> 免费获取。
                </p>
                
                <button 
                    onClick={handleSelectKey}
                    className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl font-medium transition-all hover:scale-[1.02] shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2"
                >
                    <Key className="w-4 h-4" />
                    选择 API 密钥
                </button>
            </div>
        </div>
    );
  }

  // ── Video tab ──
  if (activeTab === 'video') {
    return (
      <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
        {/* Tab bar */}
        <div className="flex-shrink-0 bg-gradient-to-r from-gray-900 via-gray-900/95 to-gray-900 border-b border-white/[0.06] px-6 flex items-center h-12 gap-1 backdrop-blur-xl">
          <button
            onClick={() => setActiveTab('image')}
            className={`relative px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
              activeTab === 'image'
                ? 'bg-indigo-600/15 text-indigo-300 after:absolute after:bottom-0 after:left-2 after:right-2 after:h-[2px] after:bg-gradient-to-r after:from-indigo-500 after:to-purple-500 after:rounded-full'
                : 'text-gray-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <span className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4" />
              图片处理
            </span>
          </button>
          <button
            onClick={() => setActiveTab('video')}
            className={`relative px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
              activeTab === 'video'
                ? 'bg-indigo-600/15 text-indigo-300 after:absolute after:bottom-0 after:left-2 after:right-2 after:h-[2px] after:bg-gradient-to-r after:from-indigo-500 after:to-purple-500 after:rounded-full'
                : 'text-gray-400 hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            <span className="flex items-center gap-2">
              <Film className="w-4 h-4" />
              视频合成
            </span>
          </button>
        </div>
        {/* VideoComposer takes full area */}
        <div className="flex-1 overflow-hidden">
          <VideoComposer pendingImport={pendingVideoImport} onImportConsumed={() => setPendingVideoImport(null)} />
        </div>
      </div>
    );
  }

  // ── Image Processing tab (original App layout) ──
  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
      {/* Tab bar */}
      <div className="flex-shrink-0 bg-gradient-to-r from-gray-900 via-gray-900/95 to-gray-900 border-b border-white/[0.06] px-6 flex items-center h-12 gap-1 backdrop-blur-xl">
        <button
          onClick={() => setActiveTab('image')}
          className={`relative px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
            activeTab === 'image'
              ? 'bg-indigo-600/15 text-indigo-300 after:absolute after:bottom-0 after:left-2 after:right-2 after:h-[2px] after:bg-gradient-to-r after:from-indigo-500 after:to-purple-500 after:rounded-full'
              : 'text-gray-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          <span className="flex items-center gap-2">
            <ImageIcon className="w-4 h-4" />
            图片处理
          </span>
        </button>
        <button
          onClick={() => {
            // Sync completed batch results to video composer when switching tabs
            const completedResults = batchResults.filter(r => r.status === ProcessStatus.COMPLETED && r.resultUrl);
            if (completedResults.length > 0) {
              const importItems = completedResults.map(r => ({
                url: r.resultUrl!,
                name: r.imageName,
                relativePath: r.relativePath || '',
              }));
              setPendingVideoImport(importItems);
            }
            setActiveTab('video');
          }}
          className={`relative px-4 py-2 text-sm font-medium rounded-lg transition-all duration-200 ${
            activeTab === 'video'
              ? 'bg-indigo-600/15 text-indigo-300 after:absolute after:bottom-0 after:left-2 after:right-2 after:h-[2px] after:bg-gradient-to-r after:from-indigo-500 after:to-purple-500 after:rounded-full'
              : 'text-gray-400 hover:text-white hover:bg-white/[0.04]'
          }`}
        >
          <span className="flex items-center gap-2">
            <Film className="w-4 h-4" />
            视频合成
          </span>
        </button>
      </div>

      {/* Original sidebar + main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Controls */}
        <aside className="w-80 flex-shrink-0 bg-gradient-to-b from-gray-900 to-gray-950 border-r border-white/[0.06] flex flex-col">
          {/* Fixed Header */}
          <div className="flex-shrink-0 p-4 pb-2">
            <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent flex items-center gap-2" style={{textShadow: '0 0 40px rgba(99,102,241,0.15)'}}>
              <Layers className="w-6 h-6 text-indigo-400" />
              CleanSlate AI
            </h1>
            <p className="text-xs text-gray-500 mt-1">批量去字 & 品牌水印</p>
          </div>

          {/* Scrollable Sections Area */}
          <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2 scrollbar-thin">

          {/* Model Selector - Collapsible */}
          <div className="border border-white/[0.06] rounded-xl overflow-hidden bg-white/[0.01]">
            <button
              onClick={() => toggleSection('model')}
              className="w-full flex items-center justify-between p-3 hover:bg-white/[0.03] transition-colors"
            >
              <label className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 cursor-pointer">
                <Zap className="w-4 h-4 text-indigo-400" />
                模型选择
              </label>
              <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isSectionCollapsed('model') ? '' : 'rotate-180'}`} />
            </button>
            <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isSectionCollapsed('model') ? 'max-h-0' : 'max-h-[500px]'}`}>
              <div className="px-3 pb-3 grid grid-cols-1 gap-2">
                <button
                  onClick={() => setAiModel('gemini-2.5-flash-image')}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 ${
                    aiModel === 'gemini-2.5-flash-image'
                    ? 'bg-indigo-900/40 border-indigo-500/50 text-white shadow-[0_0_15px_-5px_rgba(99,102,241,0.3)]'
                    : 'bg-gray-800/50 border-white/[0.06] text-gray-400 hover:bg-gray-800 hover:border-white/[0.1]'
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-indigo-400">
                    <Zap className="w-4 h-4" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-medium flex items-center justify-between">
                      标准模式
                      <span className="text-[10px] bg-green-900/50 text-green-300 px-1.5 rounded">免费</span>
                    </div>
                    <div className="text-xs opacity-70">Flash (速度快，免费额度)</div>
                  </div>
                </button>

                <button
                  onClick={() => setAiModel('gemini-3-pro-image-preview')}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 ${
                    aiModel === 'gemini-3-pro-image-preview'
                    ? 'bg-purple-900/40 border-purple-500/50 text-white shadow-[0_0_15px_-5px_rgba(168,85,247,0.3)]'
                    : 'bg-gray-800/50 border-white/[0.06] text-gray-400 hover:bg-gray-800 hover:border-white/[0.1]'
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400">
                    <Crown className="w-4 h-4" />
                  </div>
                  <div className="text-left flex-1">
                    <div className="font-medium">专业模式</div>
                    <div className="text-xs opacity-70">Pro (画质最佳，需计费)</div>
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* API Key Settings - Collapsible */}
          <div className="border border-white/[0.06] rounded-xl overflow-hidden bg-white/[0.01]">
            <button
              onClick={() => toggleSection('api')}
              className="w-full flex items-center justify-between p-3 hover:bg-white/[0.03] transition-colors"
            >
              <label className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 cursor-pointer">
                <Key className="w-4 h-4 text-indigo-400" />
                API 设置
              </label>
              <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isSectionCollapsed('api') ? '' : 'rotate-180'}`} />
            </button>
            <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isSectionCollapsed('api') ? 'max-h-0' : 'max-h-[500px]'}`}>
              <div className="px-3 pb-3 space-y-3">
                {apiKeySaved ? (
                  <div className="flex items-center justify-between bg-gray-800/40 rounded-lg p-2.5 border border-white/[0.06]">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500"></div>
                      <span className="text-sm text-gray-300">API Key 已配置</span>
                    </div>
                    <button
                      onClick={handleRemoveApiKey}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      移除
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="password"
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      placeholder="输入 Gemini API Key"
                      className="w-full bg-gray-900/80 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-indigo-500/50 focus:shadow-[0_0_10px_-3px_rgba(99,102,241,0.2)] transition-all"
                    />
                    <button
                      onClick={handleSaveApiKey}
                      disabled={!apiKeyInput.trim()}
                      className="w-full py-2 px-3 bg-gradient-to-r from-indigo-600 to-indigo-600 hover:from-indigo-500 hover:to-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2"
                    >
                      <Key className="w-3.5 h-3.5" />
                      保存 API Key
                    </button>
                  </>
                )}
                {(window as any).aistudio && (
                  <button
                    onClick={handleSelectKey}
                    className="w-full py-2 px-3 bg-white/[0.05] hover:bg-white/[0.08] text-gray-300 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 border border-white/[0.06]"
                  >
                    <Key className="w-3.5 h-3.5" />
                    从 AI Studio 选择
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Mode Selector - Collapsible */}
          <div className="border border-white/[0.06] rounded-xl overflow-hidden bg-white/[0.01]">
            <button
              onClick={() => toggleSection('mode')}
              className="w-full flex items-center justify-between p-3 hover:bg-white/[0.03] transition-colors"
            >
              <label className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 cursor-pointer">
                <Wand2 className="w-4 h-4 text-indigo-400" />
                操作模式
              </label>
              <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isSectionCollapsed('mode') ? '' : 'rotate-180'}`} />
            </button>
            <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isSectionCollapsed('mode') ? 'max-h-0' : 'max-h-[500px]'}`}>
              <div className="px-3 pb-3 grid grid-cols-1 gap-2">
                <button
                  onClick={() => setMode('add-logo')}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 ${
                    mode === 'add-logo'
                      ? 'bg-indigo-900/40 border-indigo-500/50 text-white shadow-[0_0_15px_-5px_rgba(99,102,241,0.3)]'
                      : 'bg-gray-800/50 border-white/[0.06] text-gray-400 hover:bg-gray-800 hover:border-white/[0.1]'
                  }`}
                >
                  <Stamp className="w-5 h-5" />
                  <div className="text-left">
                    <div className="font-medium">添加 Logo</div>
                    <div className="text-xs opacity-70">水印布局</div>
                  </div>
                </button>

                <button
                  onClick={() => setMode('both')}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 ${
                    mode === 'both'
                      ? 'bg-indigo-900/40 border-indigo-500/50 text-white shadow-[0_0_15px_-5px_rgba(99,102,241,0.3)]'
                      : 'bg-gray-800/50 border-white/[0.06] text-gray-400 hover:bg-gray-800 hover:border-white/[0.1]'
                  }`}
                >
                  <Layers className="w-5 h-5" />
                  <div className="text-left">
                    <div className="font-medium">去字 & 水印</div>
                    <div className="text-xs opacity-70">先去字，后加 Logo</div>
                  </div>
                </button>

                <button
                  onClick={() => setMode('crop-only')}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all duration-200 ${
                    mode === 'crop-only'
                      ? 'bg-indigo-900/40 border-indigo-500/50 text-white shadow-[0_0_15px_-5px_rgba(99,102,241,0.3)]'
                      : 'bg-gray-800/50 border-white/[0.06] text-gray-400 hover:bg-gray-800 hover:border-white/[0.1]'
                  }`}
                >
                  <CropIcon className="w-5 h-5" />
                  <div className="text-left">
                    <div className="font-medium">仅裁剪</div>
                    <div className="text-xs opacity-70">批量裁剪，无需 Logo</div>
                  </div>
                </button>
              </div>
            </div>
          </div>

          {/* Global Crop Settings - Collapsible */}
          <div className="border border-white/[0.06] rounded-xl overflow-hidden bg-white/[0.01]">
            <button
              onClick={() => toggleSection('crop')}
              className="w-full flex items-center justify-between p-3 hover:bg-white/[0.03] transition-colors"
            >
              <label className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 cursor-pointer">
                <CropIcon className="w-4 h-4 text-indigo-400" />
                批量裁剪参数
              </label>
              <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isSectionCollapsed('crop') ? '' : 'rotate-180'}`} />
            </button>
            <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isSectionCollapsed('crop') ? 'max-h-0' : 'max-h-[500px]'}`}>
              <div className="px-3 pb-3 bg-white/[0.02] space-y-3">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-gray-800"
                    checked={enableBatchCrop}
                    onChange={(e) => setEnableBatchCrop(e.target.checked)}
                  />
                  <span className="text-sm text-gray-300 group-hover:text-white transition-colors">自动对所有图片应用裁剪规则</span>
                </label>

                <div className="flex bg-gray-900/80 rounded-lg p-1 gap-1 border border-white/[0.06]">
                  <button
                    onClick={() => setBatchCropAspect(1)}
                    className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-all duration-200 ${batchCropAspect === 1 ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'}`}
                  >
                    1:1 比例
                  </button>
                  <button
                    onClick={() => setBatchCropAspect(3/4)}
                    className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-all duration-200 ${batchCropAspect === 3/4 ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'}`}
                  >
                    3:4 比例
                  </button>
                  <button
                    onClick={() => setBatchCropAspect(null)}
                    className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-all duration-200 ${batchCropAspect === null ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'}`}
                  >
                    自定义尺寸
                  </button>
                </div>
                {batchCropAspect === null && (
                  <div className="flex items-center gap-2 pt-1 transition-all">
                    <div className="flex-1 flex items-center bg-gray-900/80 rounded-lg px-2 border border-white/[0.06] focus-within:border-indigo-500/50 focus-within:shadow-[0_0_10px_-3px_rgba(99,102,241,0.2)] transition-all">
                      <span className="text-xs text-gray-500 px-1 font-medium">W</span>
                      <input
                        type="number"
                        value={batchCropWidth}
                        onChange={e => setBatchCropWidth(Math.max(1, parseInt(e.target.value) || 0))}
                        className="w-full bg-transparent text-sm text-white py-1.5 outline-none text-center"
                      />
                    </div>
                    <span className="text-gray-600 text-xs font-medium px-1">x</span>
                    <div className="flex-1 flex items-center bg-gray-900/80 rounded-lg px-2 border border-white/[0.06] focus-within:border-indigo-500/50 focus-within:shadow-[0_0_10px_-3px_rgba(99,102,241,0.2)] transition-all">
                      <span className="text-xs text-gray-500 px-1 font-medium">H</span>
                      <input
                        type="number"
                        value={batchCropHeight}
                        onChange={e => setBatchCropHeight(Math.max(1, parseInt(e.target.value) || 0))}
                        className="w-full bg-transparent text-sm text-white py-1.5 outline-none text-center"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Logo Controls - Collapsible (Only if logo mode) */}
          {(mode === 'add-logo' || mode === 'both') && (
            <div className="border border-white/[0.06] rounded-xl overflow-hidden bg-white/[0.01]">
              <button
                onClick={() => toggleSection('logo')}
                className="w-full flex items-center justify-between p-3 hover:bg-white/[0.03] transition-colors"
              >
                <label className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 cursor-pointer">
                  <Stamp className="w-4 h-4 text-indigo-400" />
                  Logo 配置
                </label>
                <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isSectionCollapsed('logo') ? '' : 'rotate-180'}`} />
              </button>
              <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isSectionCollapsed('logo') ? 'max-h-0' : 'max-h-[800px]'}`}>
                <div className="px-3 pb-3">
                  <LogoControls
                    logoItems={logoItems}
                    settings={logoSettings}
                    onSettingsChange={setLogoSettings}
                    onLogosUpload={handleLogosUpload}
                    onLogoRemove={handleLogoRemove}
                    onLogoReorder={handleLogoReorder}
                    previewImageUrl={firstPreviewImage}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Detail Page Crop - Collapsible */}
          <div className="border border-white/[0.06] rounded-xl overflow-hidden bg-white/[0.01]">
            <button
              onClick={() => toggleSection('detailCrop')}
              className="w-full flex items-center justify-between p-3 hover:bg-white/[0.03] transition-colors"
            >
              <label className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 cursor-pointer">
                <Maximize className="w-4 h-4 text-indigo-400" />
                详情页裁剪
              </label>
              <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isSectionCollapsed('detailCrop') ? '' : 'rotate-180'}`} />
            </button>
            <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isSectionCollapsed('detailCrop') ? 'max-h-0' : 'max-h-[500px]'}`}>
              <div className="px-3 pb-3 bg-white/[0.02] space-y-3">
                {/* Radio Group */}
                <div className="space-y-2">
                  {([
                    { value: '1:1' as const, label: '1:1', desc: '适合 Ozon/Shopify 主图' },
                    { value: '3:4' as const, label: '3:4', desc: '适合服饰类详情页' },
                    { value: 'custom' as const, label: '自定义尺寸', desc: '' },
                    { value: 'manual' as const, label: '自定义节点', desc: '手动标记裁剪位置' },
                  ]).map((option) => (
                    <label
                      key={option.value}
                      onClick={() => setDetailCropRatio(option.value)}
                      className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition-all border ${
                        detailCropRatio === option.value
                          ? 'bg-indigo-900/30 border-indigo-500/50'
                          : 'border-white/[0.04] hover:bg-white/[0.03]'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                        detailCropRatio === option.value ? 'border-indigo-500' : 'border-gray-600'
                      }`}>
                        {detailCropRatio === option.value && (
                          <div className="w-2 h-2 rounded-full bg-indigo-500" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-200 font-medium">{option.label}</div>
                        {option.desc && (
                          <div className="text-xs text-gray-500 mt-0.5">{option.desc}</div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>

                {/* Custom Size Inputs */}
                {detailCropRatio === 'custom' && (
                  <div className="space-y-2 pt-1 animate-in fade-in duration-200">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <label className="text-xs text-gray-500 mb-1 block">宽度 (px)</label>
                        <div className="flex items-center bg-gray-900 rounded-lg px-2 border border-gray-700 focus-within:border-indigo-500 transition-colors">
                          <input
                            type="number"
                            value={detailCropWidthPx}
                            onChange={e => setDetailCropWidthPx(Math.max(1, parseInt(e.target.value) || 0))}
                            className="w-full bg-transparent text-sm text-white py-1.5 outline-none text-center"
                          />
                          <span className="text-xs text-gray-500 pl-1">px</span>
                        </div>
                      </div>
                      <span className="text-gray-600 text-xs font-medium pt-5">×</span>
                      <div className="flex-1">
                        <label className="text-xs text-gray-500 mb-1 block">高度 (px)</label>
                        <div className="flex items-center bg-gray-900 rounded-lg px-2 border border-gray-700 focus-within:border-indigo-500 transition-colors">
                          <input
                            type="number"
                            value={detailCropHeightPx}
                            onChange={e => setDetailCropHeightPx(Math.max(1, parseInt(e.target.value) || 0))}
                            className="w-full bg-transparent text-sm text-white py-1.5 outline-none text-center"
                          />
                          <span className="text-xs text-gray-500 pl-1">px</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Slice Button */}
                {images.length > 0 && (
                  <div className="pt-2">
                    <div className="text-xs text-gray-500 mb-2">选择要切片的图片：</div>
                    <div className="space-y-1 max-h-32 overflow-y-auto scrollbar-thin">
                      {images.map(img => {
                        const hasSliceResult = slicedResults.some(r => r.sourceImageId === img.id && !r.isSlicing);
                        const isCurrentSlicing = slicedResults.some(r => r.sourceImageId === img.id && r.isSlicing);
                        const sliceResult = slicedResults.find(r => r.sourceImageId === img.id);
                        const isManualMode = detailCropRatio === 'manual';
                        return (
                          <button
                            key={img.id}
                            onClick={() => handleSliceImage(img.id)}
                            disabled={isCurrentSlicing}
                            className={`w-full flex items-center gap-2 p-2 rounded-lg text-xs text-left transition-colors ${
                              hasSliceResult && sliceResult?.cropNodes
                                ? 'bg-yellow-900/20 border border-yellow-700/30 text-yellow-300'
                                : hasSliceResult
                                ? 'bg-green-900/20 border border-green-700/30 text-green-300'
                                : isCurrentSlicing
                                ? 'bg-gray-700 text-gray-500 cursor-wait'
                                : isManualMode
                                ? 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 hover:border-yellow-500/30'
                                : 'bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700'
                            }`}
                          >
                            <img src={img.previewUrl} className="w-6 h-6 object-cover rounded" alt="" />
                            <span className="truncate flex-1">{img.originalFile.name}</span>
                            {hasSliceResult && sliceResult?.cropNodes && (
                              <span className="text-[10px] text-yellow-400">自定义节点</span>
                            )}
                            {hasSliceResult && !sliceResult?.cropNodes && (
                              <span className="text-[10px] text-green-400">已切片</span>
                            )}
                            {isCurrentSlicing && (
                              <div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          </div>

          {/* Fixed Action Button */}
          <div className="flex-shrink-0 p-4 pt-2 border-t border-white/[0.06]">
            <button
              onClick={processBatch}
              disabled={isProcessing || images.length === 0 || ((mode === 'add-logo' || mode === 'both') && logoItems.length === 0) || (mode === 'crop-only' && !enableBatchCrop)}
              className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all duration-300 ${
                isProcessing || images.length === 0 || ((mode === 'add-logo' || mode === 'both') && logoItems.length === 0) || (mode === 'crop-only' && !enableBatchCrop)
                  ? 'bg-gray-800/50 text-gray-500 cursor-not-allowed border border-white/[0.04]'
                  : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white transform hover:scale-[1.02] shadow-[0_0_30px_-8px_rgba(99,102,241,0.4)] hover:shadow-[0_0_40px_-8px_rgba(99,102,241,0.5)]'
              }`}
            >
              {isProcessing ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  处理中...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 fill-current" />
                  开始处理
                </>
              )}
            </button>
          </div>
        </aside>

        {/* Main Content Area - Drag Target */}
        <main 
          className="flex-1 flex flex-col bg-gray-950 overflow-hidden relative"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Drag Overlay */}
          {isDraggingOver && (
              <div className="absolute inset-0 z-50 bg-indigo-500/10 backdrop-blur-sm border-4 border-dashed border-indigo-500 m-4 rounded-3xl flex flex-col items-center justify-center pointer-events-none animate-in fade-in duration-200">
                  <Upload className="w-16 h-16 text-indigo-400 mb-4 animate-bounce" />
                  <h2 className="text-3xl font-bold text-indigo-200">释放以添加图片</h2>
                  <p className="text-indigo-300 mt-2">支持批量导入文件或整个文件夹（递归扫描子目录）</p>
              </div>
          )}

          {/* Header / Stats */}
          <header className="border-b border-white/[0.06] px-6 py-3 bg-gradient-to-r from-gray-900/80 via-gray-900/60 to-transparent backdrop-blur-xl z-20">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4 min-w-0 flex-shrink-0">
                 <span className="text-gray-400 text-sm whitespace-nowrap">
                    已加载 {images.length} 张图片
                    {currentFolderPath && currentFolderNode && (
                      <span className="text-gray-600 ml-1">
                        (当前: {currentFolderNode.directImageCount} 张
                        {currentFolderNode.children.length > 0 && ` + ${currentFolderNode.children.length} 个文件夹`})
                      </span>
                    )}
                 </span>
                 {hasCompletedImages && (
                    <span className="text-green-400 text-sm flex items-center gap-1 whitespace-nowrap">
                       <div className="w-2 h-2 rounded-full bg-green-500"></div>
                       准备下载
                    </span>
                 )}
              </div>

              <div className="flex items-center gap-2 flex-wrap justify-end">
                 {hasCompletedImages && (
                    <>
                      <button
                        onClick={toggleSelectAll}
                        title={allSelected ? '取消全选' : '全选'}
                        className="px-3 py-1.5 text-sm bg-white/[0.06] hover:bg-white/[0.1] text-white rounded-lg transition-all flex items-center gap-1.5 border border-white/[0.04] whitespace-nowrap"
                      >
                        {allSelected ? <CheckSquare className="w-4 h-4 text-indigo-400 flex-shrink-0" /> : <Square className="w-4 h-4 flex-shrink-0" />}
                        {allSelected ? '取消全选' : '全选'}
                      </button>
                      <button
                        onClick={handleDownloadSelected}
                        disabled={isZipping}
                        title="批量下载"
                        className="px-3 py-1.5 text-sm bg-gradient-to-r from-indigo-600 to-indigo-600 hover:from-indigo-500 hover:to-indigo-500 disabled:from-indigo-800 disabled:to-indigo-800 disabled:text-gray-400 text-white rounded-lg transition-all flex items-center gap-1.5 shadow-lg shadow-indigo-900/30 whitespace-nowrap"
                      >
                        {isZipping ? (
                            <>
                               <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin flex-shrink-0" />
                               打包中...
                            </>
                        ) : (
                            <>
                               <Package className="w-4 h-4 flex-shrink-0" />
                               {selectedCompletedImages.length > 0 ? `下载选中 (${selectedCompletedImages.length})` : '批量下载'}
                            </>
                        )}
                      </button>
                    </>
                 )}
                 
                 <button 
                    onClick={clearAll}
                    title="清空所有"
                    className="px-3 py-1.5 text-sm text-red-400 hover:bg-red-900/20 hover:border-red-500/20 rounded-lg transition-all flex items-center gap-1.5 border border-transparent whitespace-nowrap"
                    disabled={isProcessing}
                 >
                    <Trash2 className="w-4 h-4 flex-shrink-0"/> 清空所有
                 </button>
                 <label title="添加图片" className="cursor-pointer px-3 py-1.5 text-sm bg-white/[0.06] hover:bg-white/[0.1] text-white rounded-lg transition-all flex items-center gap-1.5 border border-white/[0.04] whitespace-nowrap">
                    <Upload className="w-4 h-4 flex-shrink-0"/> 添加图片
                    <input type="file" multiple accept="image/*" onChange={handleImageUpload} className="hidden" />
                 </label>
                 <label title="选择文件夹" className="cursor-pointer px-3 py-1.5 text-sm bg-white/[0.06] hover:bg-white/[0.1] text-white rounded-lg transition-all flex items-center gap-1.5 border border-white/[0.04] whitespace-nowrap">
                    <FolderOpen className="w-4 h-4 flex-shrink-0"/> 选择文件夹
                    <input type="file" onChange={handleFolderUpload} className="hidden" {...({ webkitdirectory: 'true', directory: 'true' } as Record<string, string>)} />
                 </label>
              </div>
            </div>

            {/* Global Progress Bar */}
            {globalProgress && (() => {
              const { current, total, startTime } = globalProgress;
              const percent = total > 0 ? Math.round((current / total) * 100) : 0;
              return (
                <div className="w-full flex items-center gap-3 mt-2">
                  <div className="flex-1">
                    <div className="w-full bg-gray-700/50 rounded-full h-3 overflow-hidden backdrop-blur-sm">
                      <div
                        className="bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 h-full transition-all duration-300 ease-out rounded-full relative overflow-hidden"
                        style={{ width: `${percent}%` }}
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_2s_infinite]" />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs whitespace-nowrap">
                    <span className="text-indigo-300 font-bold tabular-nums">{current}/{total}</span>
                    <span className="text-gray-500">({percent}%)</span>
                    {getEtaString(globalProgress) && (
                      <span className="text-yellow-400">剩余 {getEtaString(globalProgress)}</span>
                    )}
                    {getAvgTimeString(globalProgress) && (
                      <span className="text-gray-600">{getAvgTimeString(globalProgress)}</span>
                    )}
                  </div>
                </div>
              );
            })()}
          </header>

          {/* Image Grid */}
          <div className="flex-1 overflow-y-auto p-6 z-10 scrollbar-thin">
            {images.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-500 border-2 border-dashed border-white/[0.08] rounded-3xl bg-gradient-to-br from-gray-900/40 via-gray-900/20 to-indigo-900/10 m-4 backdrop-blur-sm">
                <div className="p-8 bg-gradient-to-br from-indigo-900/30 to-purple-900/30 rounded-full mb-6 ring-1 ring-indigo-500/20 animate-pulse">
                  <ImageIcon className="w-12 h-12 text-indigo-400" />
                </div>
                <h2 className="text-2xl font-semibold text-gray-200 mb-2">拖放图片或文件夹到这里</h2>
                <p className="max-w-md text-center text-gray-500">
                  上传多张图片或整个文件夹以批量去除文字或添加您的品牌水印。支持递归扫描子文件夹。
                </p>
                <div className="mt-8 flex gap-4">
                  <label className="px-8 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl cursor-pointer font-medium transition-all hover:scale-105 shadow-lg shadow-indigo-500/20">
                    选择文件
                    <input type="file" multiple accept="image/*" onChange={handleImageUpload} className="hidden" />
                  </label>
                  <label className="px-8 py-3 bg-white/[0.06] hover:bg-white/[0.1] text-white rounded-xl cursor-pointer font-medium transition-all hover:scale-105 flex items-center gap-2 border border-white/[0.08]">
                    <FolderOpen className="w-5 h-5" /> 选择文件夹
                    <input type="file" onChange={handleFolderUpload} className="hidden" {...({ webkitdirectory: 'true', directory: 'true' } as Record<string, string>)} />
                  </label>
                </div>
              </div>
            ) : (
              <>
                {/* Breadcrumb Navigation */}
                {images.some(img => img.relativePath) && (
                  <div className="flex items-center gap-1 mb-4 flex-wrap">
                    <button
                      onClick={() => navigateToFolder(null)}
                      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-all ${
                        currentFolderPath === null
                          ? 'bg-indigo-600/20 text-indigo-300 font-medium'
                          : 'text-gray-400 hover:text-white hover:bg-white/[0.04]'
                      }`}
                    >
                      <FolderOpen className="w-4 h-4" />
                      全部图片
                    </button>
                    {breadcrumbSegments.map((seg, idx) => (
                      <React.Fragment key={seg.fullPath}>
                        <ChevronRight className="w-4 h-4 text-gray-600 flex-shrink-0" />
                        <button
                          onClick={() => {
                            if (idx < breadcrumbSegments.length - 1) {
                              navigateToFolder(seg.fullPath);
                            }
                          }}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-all ${
                            idx === breadcrumbSegments.length - 1
                              ? 'bg-indigo-600/20 text-indigo-300 font-medium cursor-default'
                              : 'text-gray-400 hover:text-white hover:bg-white/[0.04]'
                          }`}
                        >
                          <Folder className="w-3.5 h-3.5" />
                          {seg.name}
                        </button>
                      </React.Fragment>
                    ))}
                  </div>
                )}

                {/* Folder Cards Grid */}
                {currentFolderNode && currentFolderNode.children.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4 mb-6">
                    {currentFolderNode.children.map((folder) => {
                      const completedInFolder = images.filter(img => {
                        if (img.status !== ProcessStatus.COMPLETED || !img.resultUrl) return false;
                        if (!folder.fullPath) return !img.relativePath;
                        return img.relativePath === folder.fullPath || img.relativePath?.startsWith(folder.fullPath + '/');
                      }).length;
                      return (
                        <div
                          key={folder.fullPath}
                          className="group flex flex-col bg-gray-800/60 border border-white/[0.06] rounded-xl overflow-hidden hover:border-indigo-500/40 hover:bg-gray-800/80 transition-all duration-200 hover:shadow-[0_0_20px_-5px_rgba(99,102,241,0.15)]"
                        >
                          {/* Folder Preview — clickable area */}
                          <button
                            onClick={() => navigateToFolder(folder.fullPath)}
                            className="aspect-square bg-gray-900/80 flex items-center justify-center overflow-hidden relative w-full cursor-pointer"
                          >
                            {folder.previewUrl ? (
                              <img
                                src={folder.previewUrl}
                                className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-all duration-300"
                                alt={folder.name}
                              />
                            ) : (
                              <Folder className="w-12 h-12 text-gray-600" />
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-gray-900/90 via-gray-900/20 to-transparent" />
                            {/* Download button overlay */}
                            {completedInFolder > 0 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); downloadFolderImages(folder.fullPath, folder.name); }}
                                disabled={isZipping}
                                className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-black/50 hover:bg-indigo-600 text-green-400 hover:text-white flex items-center justify-center transition-all z-20 opacity-0 group-hover:opacity-100 backdrop-blur-sm"
                                title={`下载 ${completedInFolder} 张已处理图片`}
                              >
                                <Download className="w-4 h-4" />
                              </button>
                            )}
                            <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5">
                              <Folder className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                              <span className="text-white text-xs font-medium truncate drop-shadow-lg">{folder.name}</span>
                            </div>
                          </button>
                          {/* Folder Info */}
                          <div className="p-2.5 flex items-center justify-between">
                            <span className="text-xs text-gray-400 truncate">
                              {folder.directImageCount} 张图片
                              {completedInFolder > 0 && <span className="text-green-400 ml-1">({completedInFolder} 已处理)</span>}
                            </span>
                            <span className="text-[10px] text-gray-600">
                              {folder.imageCount > folder.directImageCount ? `${folder.imageCount} 含子文件夹` : ''}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Images in current folder */}
                {currentFolderImages.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {currentFolderImages.map((img) => (
                  <div
                    key={img.id}
                    className="group relative bg-gray-800/80 rounded-xl overflow-hidden shadow-xl border border-white/[0.06] hover:border-indigo-500/40 transition-all duration-200 hover:shadow-[0_8px_30px_-8px_rgba(99,102,241,0.2)]"
                  >
                    {/* Image Preview */}
                    <div className="aspect-video relative bg-gray-900/80 flex items-center justify-center overflow-hidden">
                      {img.status === ProcessStatus.COMPLETED && img.resultUrl ? (
                           <>
                              <img src={img.resultUrl} className="w-full h-full object-contain" alt="Processed" />
                              <div className="absolute top-2 left-2 bg-gradient-to-r from-green-500 to-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow-sm backdrop-blur-sm">
                                  已处理
                              </div>
                              {/* Selection checkbox */}
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleSelect(img.id); }}
                                className={`absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center transition-all z-20 ${
                                  selectedIds.has(img.id)
                                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                                    : 'bg-black/40 text-gray-400 hover:text-white hover:bg-black/60 backdrop-blur-sm'
                                }`}
                              >
                                {selectedIds.has(img.id) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                              </button>
                           </>
                      ) : (
                           <img src={img.previewUrl} className={`w-full h-full object-contain ${img.status === ProcessStatus.PROCESSING ? 'opacity-50' : ''}`} alt="Original" />
                      )}

                      {/* Status Overlays */}
                      {img.status === ProcessStatus.PROCESSING && (
                          <div className="absolute inset-0 bg-gray-900/80 backdrop-blur-sm flex flex-col items-center justify-center z-10">
                              <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3"></div>
                              <div className="w-48 bg-white/[0.06] rounded-full h-2 mb-2 overflow-hidden backdrop-blur-sm">
                                  <div 
                                     className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full transition-all duration-300 ease-out rounded-full"
                                     style={{ width: `${img.progressValue || 0}%` }}
                                  ></div>
                              </div>
                              <span className="text-white text-sm font-medium animate-pulse">{img.progressMessage || '处理中...'}</span>
                          </div>
                      )}
                      
                      {img.status === ProcessStatus.ERROR && (
                          <div className="absolute inset-0 bg-red-900/60 flex flex-col items-center justify-center p-4 text-center">
                              <AlertCircle className="w-8 h-8 text-red-200 mb-2" />
                              <span className="text-red-200 text-xs font-medium">{img.errorMessage}</span>
                          </div>
                      )}
                    </div>

                    {/* Footer Actions */}
                    <div className="p-3 bg-gray-800/60 flex items-center justify-between border-t border-white/[0.06]">
                      <div className="truncate text-xs text-gray-400 max-w-[200px]" title={img.relativePath ? `${img.relativePath}/${img.originalFile.name}` : img.originalFile.name}>
                          {img.relativePath && <span className="text-gray-600">{img.relativePath}/</span>}
                          {img.originalFile.name}
                      </div>
                      <div className="flex gap-2">
                           <button 
                              onClick={() => setCroppingImageId(img.id)}
                              className="p-2 hover:bg-indigo-500/20 text-indigo-400 rounded-lg transition-all duration-200"
                              title="裁剪"
                              disabled={img.status === ProcessStatus.PROCESSING}
                           >
                              <CropIcon className="w-4 h-4" />
                           </button>
                           {img.status === ProcessStatus.COMPLETED ? (
                               <button 
                                  onClick={() => downloadImage(img)}
                                  className="p-2 hover:bg-green-500/20 text-green-400 rounded-lg transition-all duration-200"
                                  title="下载"
                               >
                                  <Download className="w-4 h-4" />
                               </button>
                           ) : (
                               <button 
                                  onClick={() => handleDelete(img.id)}
                                  className="p-2 hover:bg-red-500/20 text-red-400 rounded-lg transition-all duration-200"
                                  title="移除"
                                  disabled={img.status === ProcessStatus.PROCESSING}
                               >
                                  <Trash2 className="w-4 h-4" />
                               </button>
                           )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
                )}

                {/* Empty folder message */}
                {currentFolderImages.length === 0 && currentFolderNode && currentFolderNode.children.length === 0 && currentFolderPath && (
                  <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                    <Folder className="w-12 h-12 text-gray-600 mb-3 opacity-60" />
                    <p className="text-sm text-gray-400">此文件夹为空</p>
                    <button
                      onClick={() => navigateToFolder(null)}
                      className="mt-3 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      返回根目录
                    </button>
                  </div>
                )}
              </>
            )}
            {batchResults.length > 0 && (
              <div className="mt-8 pt-8 border-t border-white/[0.06]">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 text-sm text-gray-400">
                    <Stamp className="w-4 h-4 text-indigo-400" />
                    <span className="font-medium">Logo 合成结果</span>
                    <span className="text-gray-600">
                      ({batchResults.filter(r => r.status === ProcessStatus.COMPLETED).length}/{batchResults.length})
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        // Collect completed images with logos to import into video composer
                        const completedResults = batchResults.filter(r => r.status === ProcessStatus.COMPLETED && r.resultUrl);
                        if (completedResults.length > 0) {
                          const importItems = completedResults.map(r => ({
                            url: r.resultUrl!,
                            name: r.imageName,
                            relativePath: r.relativePath || '',
                          }));
                          setPendingVideoImport(importItems);
                        }
                        setActiveTab('video');
                      }}
                      className="px-3 py-1.5 text-sm bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white rounded-lg transition-all flex items-center gap-2 shadow-lg shadow-violet-900/30"
                    >
                      <Film className="w-4 h-4" />
                      视频合成
                    </button>
                    {batchResults.some(r => r.status === ProcessStatus.COMPLETED) && (
                      <button
                        onClick={handleDownloadAllBatchResults}
                        disabled={isZipping}
                        className="px-3 py-1.5 text-sm bg-gradient-to-r from-indigo-600 to-indigo-600 hover:from-indigo-500 hover:to-indigo-500 disabled:from-indigo-800 disabled:to-indigo-800 text-white rounded-lg transition-all flex items-center gap-2 shadow-lg shadow-indigo-900/30"
                      >
                        {isZipping ? (
                          <>
                            <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            打包中...
                          </>
                        ) : (
                          <>
                            <Package className="w-4 h-4" />
                            下载全部结果 ({batchResults.filter(r => r.status === ProcessStatus.COMPLETED).length})
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {!batchSelectedLogoId ? (
                  /* Level 1: Logo folder cards */
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4">
                    {Array.from(batchResultsByLogo.entries()).map(([logoId, { logo, results }]) => {
                      const completedCount = results.filter(r => r.status === ProcessStatus.COMPLETED).length;
                      const logoName = results[0]?.logoName || '未知';
                      return (
                        <div
                          key={logoId}
                          className="group flex flex-col bg-gray-800/60 border border-white/[0.06] rounded-xl overflow-hidden hover:border-indigo-500/40 hover:bg-gray-800/80 transition-all duration-200 hover:shadow-[0_0_20px_-5px_rgba(99,102,241,0.15)]"
                        >
                          <div
                            onClick={() => setBatchSelectedLogoId(logoId)}
                            className="aspect-square bg-gray-900/80 flex items-center justify-center overflow-hidden relative cursor-pointer"
                          >
                            {logo ? (
                              <img src={logo.url} className="w-full h-full object-contain p-4 opacity-70 group-hover:opacity-90 transition-all duration-300" alt={logoName} />
                            ) : (
                              <Stamp className="w-12 h-12 text-gray-600" />
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-gray-900/90 via-gray-900/20 to-transparent" />
                            {completedCount > 0 && (
                              <button
                                onClick={(e) => { e.stopPropagation(); downloadBatchFolderResults(logoId, null); }}
                                disabled={isZipping}
                                className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-black/50 hover:bg-indigo-600 text-green-400 hover:text-white flex items-center justify-center transition-all z-20 opacity-0 group-hover:opacity-100 backdrop-blur-sm"
                                title={`下载 ${completedCount} 张已合成图片`}
                              >
                                <Download className="w-4 h-4" />
                              </button>
                            )}
                            <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5">
                              <Stamp className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                              <span className="text-white text-xs font-medium truncate drop-shadow-lg">{logoName}</span>
                            </div>
                          </div>
                          <div className="p-2.5 flex items-center justify-between">
                            <span className="text-xs text-gray-400 truncate">{completedCount}/{results.length} 已完成</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Level 2+: Inside a logo folder */
                  <>
                    {/* Breadcrumb */}
                    <div className="flex items-center gap-1 mb-4 flex-wrap">
                      <button
                        onClick={() => { setBatchSelectedLogoId(null); setBatchSelectedFolderPath(null); }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-all"
                      >
                        <Stamp className="w-4 h-4" />
                        全部 Logo
                      </button>
                      <ChevronRight className="w-4 h-4 text-gray-600 flex-shrink-0" />
                      <button
                        onClick={() => setBatchSelectedFolderPath(null)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors ${
                          !batchSelectedFolderPath
                            ? 'bg-indigo-600/20 text-indigo-300 font-medium cursor-default'
                            : 'text-gray-400 hover:text-white hover:bg-white/[0.04]'
                        }`}
                      >
                        <FolderOpen className="w-4 h-4" />
                        {batchResultsByLogo.get(batchSelectedLogoId)?.results[0]?.logoName || '未知'}
                      </button>
                      {batchFolderSegments.map((seg, idx) => (
                        <React.Fragment key={seg.fullPath}>
                          <ChevronRight className="w-4 h-4 text-gray-600 flex-shrink-0" />
                          {idx < batchFolderSegments.length - 1 ? (
                            <button
                              onClick={() => setBatchSelectedFolderPath(seg.fullPath)}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-all"
                            >
                              <Folder className="w-3.5 h-3.5" />
                              {seg.name}
                            </button>
                          ) : (
                            <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm bg-indigo-600/20 text-indigo-300 font-medium">
                              <Folder className="w-3.5 h-3.5" />
                              {seg.name}
                            </span>
                          )}
                        </React.Fragment>
                      ))}
                    </div>

                    {/* Sub-folder cards */}
                    {batchLogoFolderTree && (() => {
                      const targetNode = batchSelectedFolderPath
                        ? nodeMapGet(batchLogoFolderTree, batchSelectedFolderPath)
                        : batchLogoFolderTree;
                      if (!targetNode || targetNode.children.length === 0) return null;
                      return (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4 mb-6">
                          {targetNode.children.map((folder) => {
                            const completedInFolder = batchResults.filter(r => {
                              if (r.logoId !== batchSelectedLogoId || r.status !== ProcessStatus.COMPLETED || !r.resultUrl) return false;
                              return r.relativePath === folder.fullPath || r.relativePath?.startsWith(folder.fullPath + '/');
                            }).length;
                            return (
                              <div
                                key={folder.fullPath}
                                className="group flex flex-col bg-gray-800/60 border border-white/[0.06] rounded-xl overflow-hidden hover:border-indigo-500/40 hover:bg-gray-800/80 transition-all duration-200 hover:shadow-[0_0_20px_-5px_rgba(99,102,241,0.15)]"
                              >
                                <div
                                  onClick={() => setBatchSelectedFolderPath(folder.fullPath)}
                                  className="aspect-square bg-gray-900/80 flex items-center justify-center overflow-hidden relative cursor-pointer"
                                >
                                  <Folder className="w-12 h-12 text-gray-600" />
                                  <div className="absolute inset-0 bg-gradient-to-t from-gray-900/90 via-gray-900/20 to-transparent" />
                                  {completedInFolder > 0 && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); downloadBatchFolderResults(batchSelectedLogoId!, folder.fullPath); }}
                                      disabled={isZipping}
                                      className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-black/50 hover:bg-indigo-600 text-green-400 hover:text-white flex items-center justify-center transition-all z-20 opacity-0 group-hover:opacity-100 backdrop-blur-sm"
                                      title={`下载 ${completedInFolder} 张已合成图片`}
                                    >
                                      <Download className="w-4 h-4" />
                                    </button>
                                  )}
                                  <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5">
                                    <Folder className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                                    <span className="text-white text-xs font-medium truncate drop-shadow-lg">{folder.name}</span>
                                  </div>
                                </div>
                                <div className="p-2.5 flex items-center justify-between">
                                  <span className="text-xs text-gray-400">{folder.directImageCount} 张图片</span>
                                  <span className="text-[10px] text-gray-600">
                                    {folder.imageCount > folder.directImageCount ? `${folder.imageCount} 含子文件夹` : ''}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* Processed images grid */}
                    {currentBatchResults.length > 0 && (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                        {currentBatchResults.map((result) => (
                          <div
                            key={result.id}
                            className="group relative bg-gray-800/80 rounded-xl overflow-hidden shadow-xl border border-white/[0.06] hover:border-indigo-500/40 transition-all duration-200 hover:shadow-[0_8px_30px_-8px_rgba(99,102,241,0.2)]"
                          >
                            <div className="aspect-video relative bg-gray-900/80 flex items-center justify-center overflow-hidden">
                              {result.status === ProcessStatus.COMPLETED && result.resultUrl ? (
                                <>
                                  <img src={result.resultUrl} className="w-full h-full object-contain" alt="Result" />
                                  <div className="absolute top-2 left-2 bg-gradient-to-r from-green-500 to-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow-sm backdrop-blur-sm">
                                    已完成
                                  </div>
                                </>
                              ) : result.status === ProcessStatus.PROCESSING ? (
                                <div className="flex flex-col items-center justify-center">
                                  <div className="w-10 h-10 border-[3px] border-indigo-500 border-t-transparent rounded-full animate-spin mb-2" />
                                  <span className="text-gray-400 text-xs">{result.progressMessage}</span>
                                </div>
                              ) : result.status === ProcessStatus.ERROR ? (
                                <div className="flex flex-col items-center justify-center p-4 text-center">
                                  <AlertCircle className="w-6 h-6 text-red-400 mb-2" />
                                  <span className="text-red-300 text-xs">{result.errorMessage}</span>
                                </div>
                              ) : (
                                <div className="text-gray-600 text-sm">等待处理</div>
                              )}
                            </div>
                            <div className="p-3 bg-gray-800/60 flex items-center justify-between border-t border-white/[0.06]">
                              <div className="truncate text-xs text-gray-400 max-w-[200px]">
                                {(result.imageName.substring(0, result.imageName.lastIndexOf('.')) || result.imageName)}.png
                              </div>
                              {result.status === ProcessStatus.COMPLETED && (
                                <button
                                  onClick={() => downloadBatchResult(result)}
                                  className="p-2 hover:bg-green-500/20 text-green-400 rounded-lg transition-all duration-200"
                                  title="下载"
                                >
                                  <Download className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Empty state */}
                    {currentBatchResults.length === 0 && batchLogoFolderTree && (() => {
                      const targetNode = batchSelectedFolderPath ? nodeMapGet(batchLogoFolderTree, batchSelectedFolderPath) : batchLogoFolderTree;
                      return (!targetNode || (targetNode.children.length === 0 && targetNode.directImageCount === 0));
                    })() && (
                      <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                        <Folder className="w-12 h-12 text-gray-600 mb-3 opacity-60" />
                        <p className="text-sm text-gray-400">此文件夹为空</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Detail Slice Results */}
            {slicedResults.length > 0 && (
              <div className="mt-8 pt-8 space-y-6 border-t border-white/[0.06]">
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Maximize className="w-4 h-4 text-indigo-400" />
                  <span className="font-medium">详情页切片结果</span>
                  <span className="text-gray-600">({slicedResults.length} 张长图已切片)</span>
                </div>
                {slicedResults.map(result => (
                  <DetailSlicePreview
                    key={result.sourceImageId}
                    sourceFileName={result.sourceFileName}
                    pieces={result.pieces}
                    isSlicing={result.isSlicing}
                    progressCurrent={sliceProgress?.current}
                    progressTotal={sliceProgress?.total}
                    onRemove={() => removeSlicedResult(result.sourceImageId)}
                    cropNodes={result.cropNodes}
                    sourceImageUrl={result.sourceImageUrl}
                    onReEdit={() => setCustomCropImageId(result.sourceImageId)}
                  />
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Modals */}
      {croppingImageId && croppingImage && (
        <CropModal
          imageUrl={croppingImage.status === ProcessStatus.COMPLETED && croppingImage.resultUrl ? croppingImage.resultUrl : croppingImage.previewUrl}
          onClose={() => setCroppingImageId(null)}
          onSave={handleSaveCrop}
          defaultAspect={batchCropAspect}
        />
      )}

      {/* Custom Slice Modal */}
      {customCropImageId && (() => {
        const img = images.find(i => i.id === customCropImageId);
        if (!img) return null;
        const sourceUrl = img.status === ProcessStatus.COMPLETED && img.resultUrl ? img.resultUrl : img.previewUrl;
        const existingResult = slicedResults.find(r => r.sourceImageId === customCropImageId);
        return (
          <CustomSliceModal
            imageUrl={sourceUrl}
            onClose={() => setCustomCropImageId(null)}
            initialNodes={existingResult?.cropNodes}
            onCrop={(pieces) => {
              const totalHeight = pieces.reduce((sum, p) => sum + p.height, 0);
              const nodes: number[] = [];
              let accumulated = 0;
              for (let i = 0; i < pieces.length - 1; i++) {
                accumulated += pieces[i].height;
                nodes.push((accumulated / totalHeight) * 100);
              }
              handleCustomSliceCrop(customCropImageId, pieces, nodes);
            }}
          />
        );
      })()}
    </div>
  );
}
