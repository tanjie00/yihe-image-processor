'use client';

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  Upload, Play, Download, Trash2, Film, Image as ImageIcon,
  X, Loader2, Video, FolderOpen, Pause, RotateCcw,
  Sparkles, Clock, Ratio, Layers, Folder, ChevronDown,
  ChevronRight, Check, Settings2, Zap, Eye, Package,
  CheckSquare, Square, AlertCircle, Cpu, Music, Volume2,
  VolumeX, Search, Globe, ExternalLink, Settings
} from 'lucide-react';
import {
  generateVideo,
  decodeBgmAudio,
  getAspectRatioResolution,
  TRANSITION_LABELS,
  supportsFastEncoding,
  supportsWorkerEncoding,
  supportsAudioEncoding,
  getOutputExtension,
} from '@/lib/video/videoService';
import type {
  VideoAspectRatio,
  TransitionTypeName,
  VideoSettings,
  VideoProgress,
  BgmTrack,
} from '@/lib/video/types';
import { BGM_CATEGORIES, getAllTracks, getTrackById, formatTrackDuration } from '@/lib/video/bgmLibrary';

// ==================== Types ====================

interface ImageItem {
  id: string;
  file: File;
  url: string;
  name: string;
  relativePath: string;
}

interface FolderGroup {
  name: string;
  path: string;
  images: ImageItem[];
  videoUrl?: string;
  videoBlob?: Blob;
  isGenerating: boolean;
  progress?: VideoProgress;
  isCompleted: boolean;
  error?: string;
}

// 文件夹树节点（用于层级导航）
interface VideoFolderNode {
  name: string;
  fullPath: string;
  imageCount: number;
  directImageCount: number;
  children: VideoFolderNode[];
  images: ImageItem[]; // 直接属于此文件夹的图片（不含子文件夹的）
}

// 动态并发数：限制为2，避免占用过多系统资源导致卡顿
const CONCURRENCY = supportsWorkerEncoding
  ? Math.min(navigator.hardwareConcurrency || 2, 2)
  : 2;

const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  aspectRatio: 'custom',
  fps: 30,
  imageDuration: 2,
  transitionDuration: 1,
  transition: 'fade',
  quality: 1,
};

const DEFAULT_CUSTOM_WIDTH = 900;
const DEFAULT_CUSTOM_HEIGHT = 1200;

const ASPECT_RATIO_OPTIONS: { value: VideoAspectRatio; label: string; desc: string }[] = [
  { value: '16:9', label: '16:9', desc: '横屏视频' },
  { value: '9:16', label: '9:16', desc: '竖屏/短视频' },
  { value: '4:3', label: '4:3', desc: '标准比例' },
  { value: '1:1', label: '1:1', desc: '方形视频' },
  { value: '3:4', label: '3:4', desc: '竖版' },
  { value: 'custom', label: '自定义', desc: '' },
];

const TRANSITION_CATEGORIES = [
  {
    group: '基础',
    items: ['fade'] as TransitionTypeName[],
  },
  {
    group: '滑动',
    items: ['slideLeft', 'slideRight', 'slideUp', 'slideDown'] as TransitionTypeName[],
  },
  {
    group: '创意',
    items: ['circleZoom', 'dissolve', 'granular'] as TransitionTypeName[],
  },
  {
    group: '遮挡',
    items: ['blindsH', 'blindsV', 'coverLeft', 'coverRight'] as TransitionTypeName[],
  },
];

interface VideoComposerProps {
  pendingImport?: { url: string; name: string; relativePath: string }[] | null;
  onImportConsumed?: () => void;
}

export function VideoComposer({ pendingImport, onImportConsumed }: VideoComposerProps) {
  // ==================== State ====================
  const [allImages, setAllImages] = useState<ImageItem[]>([]);
  const [folderGroups, setFolderGroups] = useState<FolderGroup[]>([]);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);
  const [videoCurrentFolderPath, setVideoCurrentFolderPath] = useState<string | null>(null);
  const [videoSettings, setVideoSettings] = useState<VideoSettings>(DEFAULT_VIDEO_SETTINGS);
  const [customWidth, setCustomWidth] = useState(DEFAULT_CUSTOM_WIDTH);
  const [customHeight, setCustomHeight] = useState(DEFAULT_CUSTOM_HEIGHT);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; startTime: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pauseResolveRef = useRef<((value: boolean) => void) | null>(null);

  // Collapsible sections state
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set(['transition', 'time', 'quality', 'music']));
  const toggleSection = (section: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };
  const isSectionCollapsed = (section: string) => collapsedSections.has(section);

  // Download state
  const [isDownloading, setIsDownloading] = useState(false);

  // BGM state
  const [selectedBgmId, setSelectedBgmId] = useState<string | null>(null);
  const [bgmVolume, setBgmVolume] = useState(0.5);
  const [bgmAudioBuffer, setBgmAudioBuffer] = useState<AudioBuffer | null>(null);
  const [bgmLoading, setBgmLoading] = useState(false);
  const [bgmError, setBgmError] = useState<string | null>(null);
  const [bgmSearchQuery, setBgmSearchQuery] = useState('');
  const [customBgmFile, setCustomBgmFile] = useState<File | null>(null);
  const [isBgmPlaying, setIsBgmPlaying] = useState(false);
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null);

  // Pixabay online music state
  const [bgmTab, setBgmTab] = useState<'builtin' | 'online'>('builtin');
  const [pixabayQuery, setPixabayQuery] = useState('');
  const [pixabayResults, setPixabayResults] = useState<any[]>([]);
  const [pixabayLoading, setPixabayLoading] = useState(false);
  const [pixabayApiKey, setPixabayApiKey] = useState('');
  const [showPixabaySettings, setShowPixabaySettings] = useState(false);
  const [pixabayPreviewId, setPixabayPreviewId] = useState<number | null>(null);
  const pixabayPreviewRef = useRef<HTMLAudioElement | null>(null);

  // ==================== Helpers ====================
  const generateId = () => Math.random().toString(36).substring(2, 11);

  const isValidImage = (file: File) =>
    file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name);

  const isHiddenFile = (name: string): boolean => {
    return name.startsWith('.') || name === '__MACOSX' || name.includes('/__MACOSX') || name.includes('\\__MACOSX');
  };

  const getRelativePath = (file: File): string => {
    const rel = (file as any).webkitRelativePath as string;
    if (rel && rel.includes('/')) {
      return rel.substring(0, rel.lastIndexOf('/'));
    }
    return '';
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return m > 0 ? `${m}分${s}秒` : `${s}秒`;
  };

  // 获取视频文件名（含扩展名），使用完整路径确保唯一性
  const getVideoFileName = (group: FolderGroup) => {
    const ext = getOutputExtension();
    // Use full path for unique filename, replace path separators with underscores
    const safeName = group.path ? group.path.replace(/[\/\\]/g, '_') : group.name;
    return `${safeName}_video.${ext}`;
  };

  // 统一下载 Blob 的辅助函数：Electron 环境使用 IPC 保存，浏览器环境使用 <a> 元素
  const downloadBlob = useCallback(async (blob: Blob, fileName: string) => {
    // Electron environment: use IPC to save file
    if (typeof window !== 'undefined' && (window as any).electronAPI?.isElectron?.()) {
      try {
        const arrayBuffer = await blob.arrayBuffer();
        await (window as any).electronAPI.saveFile(arrayBuffer, fileName, blob.type);
        return;
      } catch (err: any) {
        if (err.message?.includes('cancelled') || err.message?.includes('取消')) return;
        console.warn('Electron save failed, falling back to browser download:', err);
      }
    }
    // Browser fallback: create <a> element
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, []);

  // ==================== BGM Handling ====================

  const handleSelectBgm = useCallback(async (track: BgmTrack) => {
    // Stop preview if playing
    stopBgmPreview();

    if (selectedBgmId === track.id) {
      // Deselect
      setSelectedBgmId(null);
      setBgmAudioBuffer(null);
      setCustomBgmFile(null);
      return;
    }

    setSelectedBgmId(track.id);
    setCustomBgmFile(null);
    setBgmError(null);
    setBgmLoading(true);

    try {
      // 内置音乐使用 builtin: 前缀，自定义音乐使用 File 对象
      const audioSource = track.isBuiltIn ? `builtin:${track.id}` : track.url;
      if (!audioSource) throw new Error('无可用音频源');
      const buffer = await decodeBgmAudio(audioSource);
      setBgmAudioBuffer(buffer);
    } catch (err: any) {
      setBgmError(`加载失败: ${err.message}`);
      setBgmAudioBuffer(null);
      setSelectedBgmId(null);
    } finally {
      setBgmLoading(false);
    }
  }, [selectedBgmId]);

  const handleCustomBgmUpload = useCallback(async (file: File) => {
    stopBgmPreview();
    setCustomBgmFile(file);
    setSelectedBgmId('__custom__');
    setBgmError(null);
    setBgmLoading(true);

    try {
      const buffer = await decodeBgmAudio(file);
      setBgmAudioBuffer(buffer);
    } catch (err: any) {
      setBgmError(`加载失败: ${err.message}`);
      setBgmAudioBuffer(null);
      setCustomBgmFile(null);
      setSelectedBgmId(null);
    } finally {
      setBgmLoading(false);
    }
  }, []);

  const handleClearBgm = useCallback(() => {
    stopBgmPreview();
    setSelectedBgmId(null);
    setBgmAudioBuffer(null);
    setCustomBgmFile(null);
    setBgmError(null);
  }, []);

  const playBgmPreview = useCallback(() => {
    const track = selectedBgmId && selectedBgmId !== '__custom__' ? getTrackById(selectedBgmId) : null;
    if (!track && !customBgmFile) return;

    stopBgmPreview();

    // 内置音乐无法直接用 <audio> 预览，使用 AudioContext 播放
    if (track?.isBuiltIn && bgmAudioBuffer) {
      try {
        const audioCtx = new AudioContext();
        const source = audioCtx.createBufferSource();
        source.buffer = bgmAudioBuffer;
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = bgmVolume;
        source.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        source.start(0);
        source.onended = () => {
          audioCtx.close();
          setIsBgmPlaying(false);
        };
        bgmAudioRef.current = { pause: () => { source.stop(); audioCtx.close(); } } as any;
        setIsBgmPlaying(true);
        return;
      } catch (e) {
        console.warn('内置音乐预览失败:', e);
      }
    }

    const audio = new Audio();
    if (customBgmFile) {
      audio.src = URL.createObjectURL(customBgmFile);
    } else if (track?.url) {
      audio.src = track.url;
    } else {
      return;
    }
    audio.volume = bgmVolume;
    audio.play().catch(() => {});
    bgmAudioRef.current = audio;
    setIsBgmPlaying(true);

    audio.addEventListener('ended', () => {
      setIsBgmPlaying(false);
    });
  }, [selectedBgmId, customBgmFile, bgmVolume, bgmAudioBuffer]);

  const stopBgmPreview = useCallback(() => {
    if (bgmAudioRef.current) {
      bgmAudioRef.current.pause();
      bgmAudioRef.current = null;
    }
    setIsBgmPlaying(false);
  }, []);

  // Initialize Pixabay API key from localStorage
  useEffect(() => {
    const savedKey = localStorage.getItem('pixabay_api_key');
    if (savedKey) setPixabayApiKey(savedKey);
  }, []);

  // Search Pixabay music
  const searchPixabayMusic = useCallback(async () => {
    if (!pixabayApiKey) {
      alert('请先设置 Pixabay API Key');
      setShowPixabaySettings(true);
      return;
    }
    setPixabayLoading(true);
    try {
      const response = await fetch(`/api/pixabay-music?q=${encodeURIComponent(pixabayQuery || 'background music')}&per_page=50`);
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || '搜索失败');
      }
      const data = await response.json();
      if (data.hits) {
        setPixabayResults(data.hits.filter((h: any) => h.audio || h.type === 'music'));
      } else {
        setPixabayResults([]);
      }
    } catch (err: any) {
      console.error('Pixabay search failed:', err);
      alert(`搜索失败: ${err.message}`);
      setPixabayResults([]);
    } finally {
      setPixabayLoading(false);
    }
  }, [pixabayApiKey, pixabayQuery]);

  // Select Pixabay track as BGM
  const handleSelectPixabayTrack = useCallback(async (track: any) => {
    stopBgmPreview();
    setSelectedBgmId(`pixabay-${track.id}`);
    setCustomBgmFile(null);
    setBgmError(null);
    setBgmLoading(true);

    try {
      const audioUrl = track.audio;
      if (!audioUrl) throw new Error('No audio URL available');

      const proxyUrl = `/api/pixabay-download?url=${encodeURIComponent(audioUrl)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const file = new File([blob], `pixabay_${track.id}.mp3`, { type: 'audio/mpeg' });

      const buffer = await decodeBgmAudio(file);
      setBgmAudioBuffer(buffer);
    } catch (err: any) {
      setBgmError(`加载失败: ${err.message}`);
      setBgmAudioBuffer(null);
      setSelectedBgmId(null);
    } finally {
      setBgmLoading(false);
    }
  }, [stopBgmPreview, decodeBgmAudio]);

  // Play preview of a Pixabay track
  const playPixabayPreview = useCallback((track: any) => {
    // Stop any existing preview
    if (pixabayPreviewRef.current) {
      pixabayPreviewRef.current.pause();
      pixabayPreviewRef.current = null;
    }
    setPixabayPreviewId(null);

    if (!track.audio) return;

    const audio = new Audio(track.audio);
    audio.volume = bgmVolume;
    audio.play().catch(() => {});
    pixabayPreviewRef.current = audio;
    setPixabayPreviewId(track.id);

    audio.addEventListener('ended', () => {
      setPixabayPreviewId(null);
      pixabayPreviewRef.current = null;
    });
  }, [bgmVolume]);

  const stopPixabayPreview = useCallback(() => {
    if (pixabayPreviewRef.current) {
      pixabayPreviewRef.current.pause();
      pixabayPreviewRef.current = null;
    }
    setPixabayPreviewId(null);
  }, []);

  // Save Pixabay API key
  const savePixabayApiKey = () => {
    if (pixabayApiKey.trim()) {
      localStorage.setItem('pixabay_api_key', pixabayApiKey.trim());
      setShowPixabaySettings(false);
    }
  };

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (bgmAudioRef.current) {
        bgmAudioRef.current.pause();
        bgmAudioRef.current = null;
      }
      if (pixabayPreviewRef.current) {
        pixabayPreviewRef.current.pause();
        pixabayPreviewRef.current = null;
      }
    };
  }, []);

  // Filter tracks by search query
  const filteredCategories = useMemo(() => {
    if (!bgmSearchQuery.trim()) return BGM_CATEGORIES;
    const query = bgmSearchQuery.toLowerCase();
    return BGM_CATEGORIES.map(cat => ({
      ...cat,
      tracks: cat.tracks.filter(t =>
        t.name.toLowerCase().includes(query) ||
        t.artist.toLowerCase().includes(query) ||
        t.category.toLowerCase().includes(query)
      ),
    })).filter(cat => cat.tracks.length > 0);
  }, [bgmSearchQuery]);

  // ==================== Import from Image Tab ====================

  const [importStatus, setImportStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!pendingImport || pendingImport.length === 0) return;

    const importImages = async () => {
      setImportStatus(`正在导入 ${pendingImport.length} 张图片...`);
      const newImages: ImageItem[] = [];

      // Build a set of existing image names to avoid duplicates
      const existingNames = new Set(allImages.map(img => img.name));

      for (const item of pendingImport) {
        try {
          // Skip if already imported (same name + path)
          const ext = item.name.includes('.') ? '' : '.jpg';
          const potentialName = item.name.includes('.') ? item.name : `${item.name}${ext}`;
          const dedupeKey = `${item.relativePath}/${potentialName}`;
          const existingDedupeKeys = new Set(allImages.map(img => `${img.relativePath}/${img.name}`));
          if (existingDedupeKeys.has(dedupeKey)) continue;

          // Fetch the blob from the result URL and create a File object
          const response = await fetch(item.url);
          const blob = await response.blob();
          // Determine file extension from blob type
          const fileExt = blob.type === 'image/png' ? '.png' : blob.type === 'image/webp' ? '.webp' : '.jpg';
          const fileName = item.name.includes('.') ? item.name : `${item.name}${fileExt}`;
          const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' });
          const url = URL.createObjectURL(file);

          newImages.push({
            id: generateId(),
            file,
            url,
            name: fileName,
            relativePath: item.relativePath,
          });
        } catch (err) {
          console.error('Failed to import image:', item.name, err);
        }
      }

      if (newImages.length > 0) {
        setAllImages(prev => [...prev, ...newImages]);
        setImportStatus(`已导入 ${newImages.length} 张图片`);
      } else {
        setImportStatus('没有新图片需要导入（已存在）');
      }

      // Notify parent that import has been consumed
      onImportConsumed?.();

      // Clear import status after 3 seconds
      setTimeout(() => setImportStatus(null), 3000);
    };

    importImages();
  }, [pendingImport, onImportConsumed]);

  // ==================== File Handling ====================

  const processFiles = useCallback((files: FileList | File[]) => {
    const validFiles = Array.from(files).filter(
      (f) => isValidImage(f) && !isHiddenFile(f.name)
    );

    if (validFiles.length === 0) return;

    const newImages: ImageItem[] = validFiles.map((file) => ({
      id: generateId(),
      file,
      url: URL.createObjectURL(file),
      name: file.name,
      relativePath: getRelativePath(file),
    }));

    setAllImages((prev) => [...prev, ...newImages]);
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleFolderUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(e.target.files);
      e.target.value = '';
    }
  };

  // Drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const traverseEntry = async (entry: any, path: string = ''): Promise<File[]> => {
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
      const entries = await new Promise<any[]>((resolve) => {
        const results: any[] = [];
        const readBatch = () => {
          dirReader.readEntries((batch: any[]) => {
            if (batch.length === 0) {
              resolve(results);
            } else {
              results.push(...batch);
              readBatch();
            }
          });
        };
        readBatch();
      });
      const currentPath = path ? `${path}/${entry.name}` : entry.name;
      for (const child of entries) {
        const childFiles = await traverseEntry(child, currentPath);
        collected.push(...childFiles);
      }
    }
    return collected;
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const items = e.dataTransfer.items;
    if (!items || items.length === 0) {
      if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files);
      return;
    }

    const allFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = (items[i] as any).webkitGetAsEntry?.();
      if (entry) {
        const files = await traverseEntry(entry);
        allFiles.push(...files);
      } else {
        const file = items[i].getAsFile();
        if (file) allFiles.push(file);
      }
    }

    if (allFiles.length > 0) processFiles(allFiles);
  };

  // ==================== Folder Grouping ====================

  useEffect(() => {
    const groups: Map<string, ImageItem[]> = new Map();

    for (const img of allImages) {
      const folderPath = img.relativePath || '';
      if (!groups.has(folderPath)) {
        groups.set(folderPath, []);
      }
      groups.get(folderPath)!.push(img);
    }

    const folderArray: FolderGroup[] = [];
    groups.forEach((images, path) => {
      // Extract the last segment as the display name
      const name = path ? path.split('/').pop()! : '根目录';
      folderArray.push({
        name,
        path,
        images,
        isGenerating: false,
        isCompleted: false,
      });
    });

    folderArray.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    // Preserve existing video results
    setFolderGroups(prev => {
      return folderArray.map(newGroup => {
        const existing = prev.find(g => g.path === newGroup.path);
        return existing ? { ...newGroup, videoUrl: existing.videoUrl, videoBlob: existing.videoBlob, isGenerating: existing.isGenerating, isCompleted: existing.isCompleted, progress: existing.progress, error: existing.error } : newGroup;
      });
    });
  }, [allImages]);

  const selectedFolder = useMemo(() => {
    return folderGroups.find(g => g.path === selectedFolderPath) || null;
  }, [folderGroups, selectedFolderPath]);

  // ==================== Folder Tree Navigation ====================

  // Build folder tree from allImages for hierarchical navigation
  const folderTree = useMemo(() => {
    const root: VideoFolderNode = { name: '根目录', fullPath: '', imageCount: 0, directImageCount: 0, children: [], images: [] };
    const nodeMap = new Map<string, VideoFolderNode>();
    nodeMap.set('', root);

    for (const img of allImages) {
      const path = img.relativePath || '';
      if (!path) {
        root.images.push(img);
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
          const node: VideoFolderNode = {
            name: parts[i],
            fullPath: currentPath,
            imageCount: 0,
            directImageCount: 0,
            children: [],
            images: [],
          };
          nodeMap.set(currentPath, node);
          const parent = nodeMap.get(parentPath);
          if (parent) parent.children.push(node);
        }

        const node = nodeMap.get(currentPath)!;
        node.imageCount++;
        if (i === parts.length - 1) {
          node.directImageCount++;
          node.images.push(img);
        }
      }
    }

    return root;
  }, [allImages]);

  // Current folder node based on navigation
  const currentVideoFolderNode = useMemo(() => {
    if (!videoCurrentFolderPath) return folderTree;
    const parts = videoCurrentFolderPath.split('/');
    let current = folderTree;
    for (const part of parts) {
      const child = current.children.find(c => c.name === part);
      if (!child) return folderTree;
      current = child;
    }
    return current;
  }, [videoCurrentFolderPath, folderTree]);

  // Breadcrumb path segments
  const videoBreadcrumbSegments = useMemo(() => {
    if (!videoCurrentFolderPath) return [];
    return videoCurrentFolderPath.split('/').map((name, idx, arr) => ({
      name,
      fullPath: arr.slice(0, idx + 1).join('/'),
    }));
  }, [videoCurrentFolderPath]);

  // Leaf folder groups visible in the current navigation context
  const visibleFolderGroups = useMemo(() => {
    // Show folder groups that match the current navigation context
    if (!videoCurrentFolderPath) {
      // At root: show all groups (no filter needed)
      return folderGroups;
    }
    // Show groups whose path starts with current folder path
    return folderGroups.filter(g =>
      g.path === videoCurrentFolderPath || g.path.startsWith(videoCurrentFolderPath + '/')
    );
  }, [folderGroups, videoCurrentFolderPath]);

  // ==================== Video Generation (Concurrent Pool with Pause/Resume) ====================

  const handleBatchGenerate = async () => {
    if (folderGroups.length === 0) return;

    setIsBatchGenerating(true);
    setIsPaused(false);
    const abortController = new AbortController();
    abortRef.current = abortController;

    const eligibleGroups = folderGroups.filter(g => g.images.length >= 2 && !g.isCompleted);
    const totalFolders = eligibleGroups.length;
    if (totalFolders === 0) {
      setIsBatchGenerating(false);
      return;
    }

    let completedCount = 0;
    let nextIndex = 0;
    const startTime = Date.now();
    setBatchProgress({ current: 0, total: totalFolders, startTime });

    const processNext = async (): Promise<void> => {
      while (nextIndex < eligibleGroups.length) {
        if (abortController.signal.aborted) return;

        // 等待暂停恢复
        if (isPaused) {
          await new Promise<boolean>((resolve) => {
            pauseResolveRef.current = resolve;
          });
          if (abortController.signal.aborted) return;
        }

        const currentIndex = nextIndex++;
        const group = eligibleGroups[currentIndex];

        // Update group state to generating
        setFolderGroups(prev => prev.map(g =>
          g.path === group.path ? { ...g, isGenerating: true, progress: undefined, error: undefined } : g
        ));

        try {
          // Load images as HTMLImageElements
          const imageElements: HTMLImageElement[] = [];
          for (const img of group.images) {
            const el = new Image();
            el.crossOrigin = 'anonymous';
            await new Promise<void>((resolve, reject) => {
              el.onload = () => resolve();
              el.onerror = () => reject(new Error(`无法加载图片: ${img.name}`));
              el.src = img.url;
            });
            imageElements.push(el);
          }

          const settings = { ...videoSettings };
          if (settings.aspectRatio === 'custom') {
            settings.customWidth = customWidth;
            settings.customHeight = customHeight;
          }

          const onProgress = (progress: VideoProgress) => {
            setFolderGroups(prev => prev.map(g =>
              g.path === group.path ? { ...g, progress } : g
            ));
          };

          const blob = await generateVideo(imageElements, settings, onProgress, abortController.signal,
            bgmAudioBuffer ? { audioBuffer: bgmAudioBuffer, volume: bgmVolume } : undefined
          );

          const url = URL.createObjectURL(blob);
          completedCount++;

          setFolderGroups(prev => prev.map(g =>
            g.path === group.path ? { ...g, isGenerating: false, isCompleted: true, videoBlob: blob, videoUrl: url, progress: undefined } : g
          ));

          setBatchProgress(prev => prev ? { ...prev, current: completedCount } : null);
        } catch (err: any) {
          if (err.name === 'AbortError') return; // Exit this worker on abort
          setFolderGroups(prev => prev.map(g =>
            g.path === group.path ? { ...g, isGenerating: false, error: err.message || '生成失败', progress: undefined } : g
          ));
          completedCount++;
          setBatchProgress(prev => prev ? { ...prev, current: completedCount } : null);
        }
      }
    };

    // Start concurrent workers
    const workerCount = Math.min(CONCURRENCY, eligibleGroups.length);
    const workers = Array.from({ length: workerCount }, () => processNext());
    await Promise.all(workers);

    setIsBatchGenerating(false);
    setIsPaused(false);
    setBatchProgress(null);
    abortRef.current = null;
  };

  const handlePause = () => {
    setIsPaused(true);
  };

  const handleResume = () => {
    setIsPaused(false);
    // 恢复所有等待中的 worker
    if (pauseResolveRef.current) {
      pauseResolveRef.current(true);
      pauseResolveRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    // 恢复暂停的 worker 让它们能检测到 abort
    if (pauseResolveRef.current) {
      pauseResolveRef.current(true);
      pauseResolveRef.current = null;
    }
    setIsBatchGenerating(false);
    setIsPaused(false);
    setBatchProgress(null);
    // Clear isGenerating on any groups still generating (they will be aborted)
    // 保留已完成的视频状态（isCompleted, videoUrl, videoBlob）
    setFolderGroups(prev => prev.map(g =>
      g.isGenerating ? { ...g, isGenerating: false, progress: undefined } : g
    ));
  };

  // ==================== Download ====================

  /**
   * 直接下载视频文件（不打包 ZIP）
   */
  const handleDownloadVideoOnly = async (group: FolderGroup) => {
    if (!group.videoBlob) {
      alert('视频文件不存在，请先生成视频');
      return;
    }
    await downloadBlob(group.videoBlob, getVideoFileName(group));
  };

  const handleDownloadVideo = async (group: FolderGroup) => {
    if (!group.videoBlob || !group.videoUrl) {
      alert('视频文件不存在，请先生成视频');
      return;
    }
    await handleDownloadVideoOnly(group);
  };

  /**
   * 下载单个文件夹的 ZIP
   * ZIP 结构保持原始子文件夹路径，视频文件放在与图片同一目录下
   */
  const handleDownloadFolder = async (group: FolderGroup) => {
    if (!group.videoBlob) {
      alert('视频文件不存在，请先生成视频');
      return;
    }

    setIsDownloading(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // 使用原始路径作为 ZIP 内的目录结构
      // group.path 是完整的相对路径（如 "folderA/subfolder"），group.name 只是最后一段
      const folderPath = group.path || group.name;
      const videoFileName = getVideoFileName(group);

      // 添加原始图片（保持原始文件名和路径）
      for (const img of group.images) {
        // 使用图片的完整相对路径（如果有的话）
        const imgPath = img.relativePath ? `${img.relativePath}/${img.name}` : `${folderPath}/${img.name}`;
        zip.file(imgPath, img.file);
      }

      // 添加视频文件到同一目录下
      zip.file(`${folderPath}/${videoFileName}`, group.videoBlob);

      const blob = await zip.generateAsync({ type: 'blob', streamFiles: true });
      await downloadBlob(blob, `${group.name}.zip`);
    } catch (err: any) {
      console.error('ZIP 下载失败:', err);
      alert(`下载失败: ${err.message || '未知错误'}`);
    } finally {
      setIsDownloading(false);
    }
  };

  /**
   * 下载所有已完成视频的 ZIP
   * 每个子文件夹包含原始图片 + 视频文件
   */
  const handleDownloadAll = async () => {
    const completedGroups = folderGroups.filter(g => g.isCompleted && g.videoBlob);
    if (completedGroups.length === 0) {
      alert('没有已完成的视频可下载');
      return;
    }
    if (completedGroups.length === 1) {
      await handleDownloadFolder(completedGroups[0]);
      return;
    }

    setIsDownloading(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      for (const group of completedGroups) {
        if (!group.videoBlob) continue;

        const folderPath = group.path || group.name;
        const videoFileName = getVideoFileName(group);

        // 添加原始图片
        for (const img of group.images) {
          const imgPath = img.relativePath ? `${img.relativePath}/${img.name}` : `${folderPath}/${img.name}`;
          zip.file(imgPath, img.file);
        }

        // 添加视频文件到同一目录下
        zip.file(`${folderPath}/${videoFileName}`, group.videoBlob);
      }

      const blob = await zip.generateAsync({ type: 'blob', streamFiles: true });
      await downloadBlob(blob, 'videos_batch.zip');
    } catch (err: any) {
      console.error('批量 ZIP 下载失败:', err);
      alert(`下载失败: ${err.message || '未知错误'}`);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleClearAll = () => {
    folderGroups.forEach(g => { if (g.videoUrl) URL.revokeObjectURL(g.videoUrl); });
    allImages.forEach(img => URL.revokeObjectURL(img.url));
    setAllImages([]);
    setFolderGroups([]);
    setSelectedFolderPath(null);
  };

  // ==================== Computed ====================

  const resolution = useMemo(
    () => getAspectRatioResolution(videoSettings.aspectRatio, customWidth, customHeight),
    [videoSettings.aspectRatio, customWidth, customHeight]
  );

  const totalImages = allImages.length;
  const completedVideos = folderGroups.filter(g => g.isCompleted).length;
  const eligibleFolders = folderGroups.filter(g => g.images.length >= 2 && !g.isCompleted).length;

  const getEtaString = (progress: { current: number; total: number; startTime: number }): string => {
    if (progress.current === 0 || progress.current >= progress.total) return '';
    const elapsed = Date.now() - progress.startTime;
    const avgTime = elapsed / progress.current;
    const remaining = (progress.total - progress.current) * avgTime;
    const seconds = Math.ceil(remaining / 1000);
    if (seconds < 60) return `约 ${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `约 ${minutes} 分 ${secs} 秒`;
  };

  // ==================== Render ====================

  return (
    <div className="flex h-full text-gray-100">
      {/* Sidebar - Settings */}
      <aside className="w-80 flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
        {/* Fixed Header */}
        <div className="flex-shrink-0 p-4 pb-2">
          <h1 className="text-xl font-bold bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent flex items-center gap-2">
            <Film className="w-6 h-6 text-violet-400" />
            视频合成
          </h1>
          <p className="text-xs text-gray-500 mt-1">批量图片合成视频 · 转场特效 · MP4 输出</p>
          <div className="mt-1.5 flex flex-col gap-1">
            {supportsWorkerEncoding && (
              <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/80">
                <Cpu className="w-3 h-3" />
                <span>多线程模式 (Worker × {CONCURRENCY})</span>
              </div>
            )}
            {supportsFastEncoding && !supportsWorkerEncoding && (
              <div className="flex items-center gap-1.5 text-[10px] text-emerald-400/80">
                <Zap className="w-3 h-3" />
                <span>快速编码模式 (VideoEncoder)</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-[10px] text-blue-400/70">
              <Video className="w-3 h-3" />
              <span>输出格式: {getOutputExtension().toUpperCase()}</span>
            </div>
            {selectedBgmId && (
              <div className="flex items-center gap-1.5 text-[10px] text-pink-400/70">
                <Music className="w-3 h-3" />
                <span>背景音乐: {customBgmFile ? '自定义' : getTrackById(selectedBgmId)?.name || '已选'}</span>
              </div>
            )}
          </div>
        </div>

        {/* Scrollable Sections */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2 scrollbar-thin scroll-container">

        {/* Video Ratio - Collapsible */}
        <div className="border border-gray-700/50 rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection('ratio')}
            className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 transition-colors"
          >
            <label className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 cursor-pointer">
              <Ratio className="w-4 h-4 text-violet-400" />
              视频比例
            </label>
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 flex-shrink-0 ${isSectionCollapsed('ratio') ? '' : 'rotate-180'}`} />
          </button>
          <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isSectionCollapsed('ratio') ? 'max-h-0' : 'max-h-[500px]'}`}>
            <div className="px-3 pb-3 grid grid-cols-2 gap-2">
              {ASPECT_RATIO_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setVideoSettings(prev => ({ ...prev, aspectRatio: opt.value }))}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all text-left ${
                    videoSettings.aspectRatio === opt.value
                      ? 'bg-violet-900/40 border-violet-500 text-white'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-750'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{opt.label}</div>
                    {opt.desc && <div className="text-xs opacity-70">{opt.desc}</div>}
                  </div>
                </button>
              ))}
            </div>
            {videoSettings.aspectRatio === 'custom' && (
              <div className="px-3 pb-3 flex items-center gap-2">
                <div className="flex-1 flex items-center bg-gray-900 rounded-lg px-2 border border-gray-700 focus-within:border-violet-500 transition-colors">
                  <span className="text-xs text-gray-500 px-1 font-medium">W</span>
                  <input
                    type="number"
                    value={customWidth}
                    onChange={e => setCustomWidth(Math.max(100, parseInt(e.target.value) || 0))}
                    className="w-full bg-transparent text-sm text-white py-1.5 outline-none text-center"
                  />
                </div>
                <span className="text-gray-600 text-xs font-medium">x</span>
                <div className="flex-1 flex items-center bg-gray-900 rounded-lg px-2 border border-gray-700 focus-within:border-violet-500 transition-colors">
                  <span className="text-xs text-gray-500 px-1 font-medium">H</span>
                  <input
                    type="number"
                    value={customHeight}
                    onChange={e => setCustomHeight(Math.max(100, parseInt(e.target.value) || 0))}
                    className="w-full bg-transparent text-sm text-white py-1.5 outline-none text-center"
                  />
                </div>
              </div>
            )}
            <div className="px-3 pb-3">
              <p className="text-xs text-gray-500">输出分辨率: {resolution.width}x{resolution.height}</p>
            </div>
          </div>
        </div>

        {/* Transition - Collapsible */}
        <div className="border border-gray-700/50 rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection('transition')}
            className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 transition-colors"
          >
            <label className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 cursor-pointer">
              <Sparkles className="w-4 h-4 text-fuchsia-400" />
              转场效果
            </label>
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 flex-shrink-0 ${isSectionCollapsed('transition') ? '' : 'rotate-180'}`} />
          </button>
          <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isSectionCollapsed('transition') ? 'max-h-0' : 'max-h-[600px]'}`}>
            <div className="px-3 pb-3 space-y-3">
              {TRANSITION_CATEGORIES.map((category) => (
                <div key={category.group} className="space-y-2">
                  <div className="text-xs text-gray-500 font-medium">{category.group}</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {category.items.map((type) => (
                      <button
                        key={type}
                        onClick={() => setVideoSettings(prev => ({ ...prev, transition: type }))}
                        className={`px-2.5 py-2 rounded-lg border text-xs font-medium transition-all text-left ${
                          videoSettings.transition === type
                            ? 'bg-fuchsia-900/40 border-fuchsia-500 text-white'
                            : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-750'
                        }`}
                      >
                        {TRANSITION_LABELS[type]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Time Settings - Collapsible */}
        <div className="border border-gray-700/50 rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection('time')}
            className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 transition-colors"
          >
            <label className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 cursor-pointer">
              <Clock className="w-4 h-4 text-amber-400" />
              时间设置
            </label>
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 flex-shrink-0 ${isSectionCollapsed('time') ? '' : 'rotate-180'}`} />
          </button>
          <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isSectionCollapsed('time') ? 'max-h-0' : 'max-h-[400px]'}`}>
            <div className="px-3 pb-3 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-300">每张图片展示时长</span>
                  <span className="text-xs text-gray-500 font-mono">{videoSettings.imageDuration}s</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={0.5}
                  value={videoSettings.imageDuration}
                  onChange={e => setVideoSettings(prev => ({ ...prev, imageDuration: parseFloat(e.target.value) }))}
                  className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-300">转场持续时间</span>
                  <span className="text-xs text-gray-500 font-mono">{videoSettings.transitionDuration}s</span>
                </div>
                <input
                  type="range"
                  min={0.3}
                  max={3}
                  step={0.1}
                  value={videoSettings.transitionDuration}
                  onChange={e => setVideoSettings(prev => ({ ...prev, transitionDuration: parseFloat(e.target.value) }))}
                  className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Quality Settings - Collapsible */}
        <div className="border border-gray-700/50 rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection('quality')}
            className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 transition-colors"
          >
            <label className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 cursor-pointer">
              <Settings2 className="w-4 h-4 text-emerald-400" />
              质量设置
            </label>
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 flex-shrink-0 ${isSectionCollapsed('quality') ? '' : 'rotate-180'}`} />
          </button>
          <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isSectionCollapsed('quality') ? 'max-h-0' : 'max-h-[400px]'}`}>
            <div className="px-3 pb-3 space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-300">帧率 (FPS)</span>
                  <span className="text-xs text-gray-500 font-mono">{videoSettings.fps}</span>
                </div>
                <input
                  type="range"
                  min={15}
                  max={60}
                  step={5}
                  value={videoSettings.fps}
                  onChange={e => setVideoSettings(prev => ({ ...prev, fps: parseInt(e.target.value) }))}
                  className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-300">视频质量</span>
                  <span className="text-xs text-gray-500 font-mono">{Math.round(videoSettings.quality * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0.3}
                  max={1}
                  step={0.1}
                  value={videoSettings.quality}
                  onChange={e => setVideoSettings(prev => ({ ...prev, quality: parseFloat(e.target.value) }))}
                  className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-violet-500"
                />
              </div>
            </div>
          </div>
        </div>

        {/* BGM (Background Music) - Collapsible */}
        <div className="border border-gray-700/50 rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection('music')}
            className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 transition-colors"
          >
            <label className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 cursor-pointer">
              <Music className="w-4 h-4 text-pink-400" />
              背景音乐
              {selectedBgmId && (
                <span className="text-[10px] bg-pink-500/20 text-pink-300 px-1.5 py-0.5 rounded-full">已选</span>
              )}
            </label>
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 flex-shrink-0 ${isSectionCollapsed('music') ? '' : 'rotate-180'}`} />
          </button>
          <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isSectionCollapsed('music') ? 'max-h-0' : 'max-h-[800px]'} overflow-y-auto scrollbar-thin scroll-container`}>
            <div className="px-3 pb-3 space-y-3">
              {/* Audio Support Notice */}
              {!supportsAudioEncoding && (
                <div className="text-xs text-amber-400/80 bg-amber-900/20 rounded-lg p-2 flex items-start gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>当前浏览器不支持音频编码，视频将不含背景音乐</span>
                </div>
              )}

              {/* BGM Tab Switcher */}
              <div className="flex bg-gray-900 rounded-lg p-0.5 border border-gray-700">
                <button
                  onClick={() => setBgmTab('builtin')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    bgmTab === 'builtin'
                      ? 'bg-pink-600/30 text-pink-300 border border-pink-500/30'
                      : 'text-gray-500 hover:text-gray-300 border border-transparent'
                  }`}
                >
                  <Music className="w-3 h-3" />
                  内置音乐
                </button>
                <button
                  onClick={() => setBgmTab('online')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    bgmTab === 'online'
                      ? 'bg-pink-600/30 text-pink-300 border border-pink-500/30'
                      : 'text-gray-500 hover:text-gray-300 border border-transparent'
                  }`}
                >
                  <Globe className="w-3 h-3" />
                  在线音乐
                </button>
              </div>

              {/* Custom Upload + Clear (shared) */}
              <div className="flex items-center gap-2">
                <label className="flex-1 cursor-pointer px-3 py-2 text-xs bg-gray-800 hover:bg-gray-750 text-gray-300 rounded-lg border border-gray-700 hover:border-pink-500/30 transition-all flex items-center gap-1.5 justify-center">
                  <Upload className="w-3.5 h-3.5" />
                  上传音乐
                  <input
                    type="file"
                    accept="audio/*"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) handleCustomBgmUpload(file);
                      e.target.value = '';
                    }}
                    className="hidden"
                  />
                </label>
                {selectedBgmId && (
                  <button
                    onClick={handleClearBgm}
                    className="px-2 py-2 text-xs text-red-400 hover:bg-red-900/20 rounded-lg border border-red-900/30 transition-colors"
                    title="移除背景音乐"
                  >
                    <VolumeX className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* BGM Error */}
              {bgmError && (
                <div className="text-xs text-red-400 bg-red-900/20 rounded-lg p-2">{bgmError}</div>
              )}

              {/* BGM Loading */}
              {bgmLoading && (
                <div className="flex items-center gap-2 text-xs text-pink-300">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  加载音频中...
                </div>
              )}

              {/* Selected Track Info + Preview + Volume */}
              {selectedBgmId && !bgmLoading && (
                <div className="bg-gray-800/50 rounded-lg p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-white truncate">
                        {customBgmFile ? customBgmFile.name : selectedBgmId.startsWith('pixabay-') ? `Pixabay #${selectedBgmId.replace('pixabay-', '')}` : getTrackById(selectedBgmId)?.name || '未知'}
                      </div>
                      {!customBgmFile && !selectedBgmId.startsWith('pixabay-') && getTrackById(selectedBgmId) && (
                        <div className="text-[10px] text-gray-500">
                          {getTrackById(selectedBgmId)!.artist} · {formatTrackDuration(getTrackById(selectedBgmId)!.duration)}
                        </div>
                      )}
                      {selectedBgmId.startsWith('pixabay-') && (
                        <div className="text-[10px] text-gray-500">Pixabay 在线音乐</div>
                      )}
                    </div>
                    <button
                      onClick={isBgmPlaying ? stopBgmPreview : playBgmPreview}
                      className="w-7 h-7 rounded-full bg-pink-600/30 hover:bg-pink-600/50 text-pink-300 flex items-center justify-center transition-colors flex-shrink-0"
                    >
                      {isBgmPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 fill-current" />}
                    </button>
                  </div>
                  {/* Volume */}
                  <div className="flex items-center gap-2">
                    <Volume2 className="w-3 h-3 text-gray-500 flex-shrink-0" />
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={bgmVolume}
                      onChange={e => {
                        const vol = parseFloat(e.target.value);
                        setBgmVolume(vol);
                        if (bgmAudioRef.current) bgmAudioRef.current.volume = vol;
                      }}
                      className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-pink-500"
                    />
                    <span className="text-[10px] text-gray-500 w-7 text-right font-mono">{Math.round(bgmVolume * 100)}%</span>
                  </div>
                </div>
              )}

              {/* Tab Content: Built-in Music */}
              {bgmTab === 'builtin' && (
                <>
                  {/* Search */}
                  <div className="flex items-center bg-gray-900 rounded-lg px-2 border border-gray-700 focus-within:border-pink-500/50 transition-colors">
                    <Search className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                    <input
                      type="text"
                      value={bgmSearchQuery}
                      onChange={e => setBgmSearchQuery(e.target.value)}
                      placeholder="搜索音乐..."
                      className="w-full bg-transparent text-xs text-white py-2 px-2 outline-none placeholder-gray-600"
                    />
                    {bgmSearchQuery && (
                      <button onClick={() => setBgmSearchQuery('')} className="text-gray-500 hover:text-white">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {/* Music Library */}
                  <div className="space-y-2.5 max-h-60 overflow-y-auto scrollbar-thin pr-1 scroll-container">
                    {filteredCategories.map(category => (
                      <div key={category.name}>
                        <div className="text-xs text-gray-500 font-medium flex items-center gap-1 mb-1.5">
                          <span>{category.icon}</span>
                          {category.name}
                        </div>
                        <div className="space-y-1">
                          {category.tracks.map(track => (
                            <button
                              key={track.id}
                              onClick={() => handleSelectBgm(track)}
                              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all text-left ${
                                selectedBgmId === track.id
                                  ? 'bg-pink-900/40 border border-pink-500/50 text-white'
                                  : 'bg-gray-800/50 border border-transparent hover:bg-gray-800 text-gray-400 hover:text-gray-300'
                              }`}
                            >
                              <Music className={`w-3 h-3 flex-shrink-0 ${selectedBgmId === track.id ? 'text-pink-400' : 'text-gray-600'}`} />
                              <div className="flex-1 min-w-0">
                                <div className="truncate">{track.name}</div>
                              </div>
                              <span className="text-[10px] text-gray-600 flex-shrink-0">{formatTrackDuration(track.duration)}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    {filteredCategories.length === 0 && (
                      <div className="text-center text-xs text-gray-600 py-4">没有找到匹配的音乐</div>
                    )}
                  </div>
                </>
              )}

              {/* Tab Content: Online Music (Pixabay) */}
              {bgmTab === 'online' && (
                <>
                  {/* API Key Settings */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        <Settings className="w-3 h-3" />
                        <span>Pixabay API Key</span>
                        {pixabayApiKey && !showPixabaySettings && (
                          <span className="text-[10px] text-emerald-400">已配置</span>
                        )}
                      </div>
                      <button
                        onClick={() => setShowPixabaySettings(!showPixabaySettings)}
                        className="text-[10px] text-pink-400 hover:text-pink-300"
                      >
                        {showPixabaySettings ? '收起' : '设置'}
                      </button>
                    </div>
                    {showPixabaySettings && (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="password"
                          value={pixabayApiKey}
                          onChange={e => setPixabayApiKey(e.target.value)}
                          placeholder="输入 Pixabay API Key"
                          className="flex-1 bg-gray-900 text-xs text-white py-1.5 px-2 rounded-lg border border-gray-700 focus:border-pink-500/50 outline-none placeholder-gray-600"
                        />
                        <button
                          onClick={savePixabayApiKey}
                          className="px-2 py-1.5 text-[10px] bg-pink-600/30 hover:bg-pink-600/50 text-pink-300 rounded-lg border border-pink-500/30 transition-colors"
                        >
                          保存
                        </button>
                      </div>
                    )}
                    {!pixabayApiKey && (
                      <div className="text-[10px] text-gray-500">
                        免费申请：{' '}
                        <a
                          href="https://pixabay.com/api/docs/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-pink-400 hover:text-pink-300 underline inline-flex items-center gap-0.5"
                        >
                          pixabay.com/api/docs <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                    )}
                  </div>

                  {/* Search */}
                  <div className="flex items-center gap-1.5">
                    <div className="flex-1 flex items-center bg-gray-900 rounded-lg px-2 border border-gray-700 focus-within:border-pink-500/50 transition-colors">
                      <Search className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                      <input
                        type="text"
                        value={pixabayQuery}
                        onChange={e => setPixabayQuery(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') searchPixabayMusic(); }}
                        placeholder="搜索在线音乐..."
                        className="w-full bg-transparent text-xs text-white py-2 px-2 outline-none placeholder-gray-600"
                      />
                    </div>
                    <button
                      onClick={searchPixabayMusic}
                      disabled={pixabayLoading}
                      className="px-3 py-2 text-xs bg-pink-600/30 hover:bg-pink-600/50 text-pink-300 rounded-lg border border-pink-500/30 transition-colors disabled:opacity-50 flex items-center gap-1"
                    >
                      {pixabayLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                      搜索
                    </button>
                  </div>

                  {/* Results */}
                  <div className="space-y-1 max-h-60 overflow-y-auto scrollbar-thin pr-1 scroll-container">
                    {pixabayLoading && (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="w-5 h-5 animate-spin text-pink-400" />
                      </div>
                    )}
                    {!pixabayLoading && pixabayResults.length === 0 && pixabayApiKey && (
                      <div className="text-center text-xs text-gray-600 py-4">
                        输入关键词搜索免费无版权音乐
                      </div>
                    )}
                    {!pixabayLoading && pixabayResults.map((track) => (
                      <div
                        key={track.id}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-all ${
                          selectedBgmId === `pixabay-${track.id}`
                            ? 'bg-pink-900/40 border border-pink-500/50 text-white'
                            : 'bg-gray-800/50 border border-transparent hover:bg-gray-800 text-gray-400 hover:text-gray-300'
                        }`}
                      >
                        <Globe className={`w-3 h-3 flex-shrink-0 ${selectedBgmId === `pixabay-${track.id}` ? 'text-pink-400' : 'text-gray-600'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="truncate">{track.tags || track.name || `Track #${track.id}`}</div>
                          <div className="text-[10px] text-gray-600 truncate">{track.user || 'Unknown'}</div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => pixabayPreviewId === track.id ? stopPixabayPreview() : playPixabayPreview(track)}
                            className="w-6 h-6 rounded-full bg-gray-700/50 hover:bg-pink-600/30 text-gray-400 hover:text-pink-300 flex items-center justify-center transition-colors"
                            title="预览"
                          >
                            {pixabayPreviewId === track.id ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5 fill-current" />}
                          </button>
                          <button
                            onClick={() => handleSelectPixabayTrack(track)}
                            disabled={bgmLoading}
                            className="w-6 h-6 rounded-full bg-gray-700/50 hover:bg-pink-600/30 text-gray-400 hover:text-pink-300 flex items-center justify-center transition-colors disabled:opacity-50"
                            title="选择"
                          >
                            <Check className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        </div>

        {/* Fixed Action Button */}
        <div className="flex-shrink-0 p-4 pt-2 border-t border-gray-800 space-y-2">
          <button
            onClick={handleBatchGenerate}
            disabled={isBatchGenerating || eligibleFolders === 0}
            className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all ${
              isBatchGenerating || eligibleFolders === 0
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-500 hover:to-fuchsia-500 text-white transform hover:scale-[1.02]'
            }`}
          >
            {isBatchGenerating ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {isPaused ? '已暂停...' : `合成中... (×${CONCURRENCY})`}
              </>
            ) : (
              <>
                <Play className="w-5 h-5 fill-current" />
                批量合成视频 ({eligibleFolders})
              </>
            )}
          </button>
          {isBatchGenerating && (
            <div className="flex gap-2">
              <button
                onClick={isPaused ? handleResume : handlePause}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center justify-center gap-1.5 ${
                  isPaused
                    ? 'text-emerald-400 hover:bg-emerald-900/20 border-emerald-900/30'
                    : 'text-amber-400 hover:bg-amber-900/20 border-amber-900/30'
                }`}
              >
                {isPaused ? (
                  <><Play className="w-3.5 h-3.5" /> 继续</>
                ) : (
                  <><Pause className="w-3.5 h-3.5" /> 暂停</>
                )}
              </button>
              <button
                onClick={handleCancel}
                className="flex-1 py-2 rounded-lg text-sm text-red-400 hover:bg-red-900/20 border border-red-900/30 transition-colors flex items-center justify-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" /> 取消
              </button>
            </div>
          )}
          {completedVideos > 0 && (
            <button
              onClick={handleDownloadAll}
              disabled={isDownloading}
              className="w-full py-2.5 rounded-xl text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
              {isDownloading ? '正在打包...' : `下载全部视频 (${completedVideos})`}
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main
        className="flex-1 flex flex-col bg-gray-950 overflow-hidden relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Drag Overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-50 bg-violet-500/10 backdrop-blur-sm border-4 border-dashed border-violet-500 m-4 rounded-3xl flex flex-col items-center justify-center pointer-events-none animate-in fade-in duration-200">
            <Upload className="w-16 h-16 text-violet-400 mb-4 animate-bounce" />
            <h2 className="text-3xl font-bold text-violet-200">释放以添加图片</h2>
            <p className="text-violet-300 mt-2">支持上传文件夹，每个子文件夹将生成一个视频</p>
          </div>
        )}

        {/* Header / Stats */}
        <header className="border-b border-gray-800 px-6 py-3 bg-gray-900/50 backdrop-blur z-20 flex-shrink-0">
          <div className="flex items-center justify-between gap-4 flex-wrap min-h-[40px]">
            <div className="flex items-center gap-4 min-w-0">
              <span className="text-gray-400 text-sm whitespace-nowrap">
                已加载 {totalImages} 张图片 · {folderGroups.length} 个文件夹
              </span>
              {importStatus && (
                <span className="text-emerald-400 text-sm flex items-center gap-1 animate-in fade-in duration-300 whitespace-nowrap">
                  <Check className="w-3 h-3" />
                  {importStatus}
                </span>
              )}
              {completedVideos > 0 && (
                <span className="text-green-400 text-sm flex items-center gap-1 whitespace-nowrap">
                  <div className="w-2 h-2 rounded-full bg-green-500"></div>
                  {completedVideos} 个视频已完成
                </span>
              )}
              {isBatchGenerating && (
                <span className={`text-sm flex items-center gap-1 whitespace-nowrap ${isPaused ? 'text-amber-400' : 'text-violet-400'}`}>
                  {isPaused ? (
                    <><Pause className="w-3 h-3" /> 已暂停</>
                  ) : (
                    <><Cpu className="w-3 h-3" /> 多线程 ×{CONCURRENCY}</>
                  )}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap justify-end">
              {completedVideos > 0 && (
                <button
                  onClick={handleDownloadAll}
                  disabled={isDownloading}
                  title="下载全部"
                  className="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors inline-flex items-center gap-1.5 shadow-lg shadow-violet-900/20 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                  {isDownloading ? '打包中...' : `下载全部 (${completedVideos})`}
                </button>
              )}
              <button
                onClick={handleClearAll}
                title="清空所有"
                className="px-3 py-1.5 text-sm text-red-400 hover:bg-red-900/20 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                disabled={isBatchGenerating}
              >
                <Trash2 className="w-4 h-4"/> 清空所有
              </button>
              <label title="添加图片" className="cursor-pointer px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap">
                <Upload className="w-4 h-4"/> 添加图片
                <input type="file" multiple accept="image/*" onChange={handleFileUpload} className="hidden" />
              </label>
              <label title="选择文件夹" className="cursor-pointer px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap">
                <FolderOpen className="w-4 h-4"/> 选择文件夹
                <input
                  ref={folderInputRef}
                  type="file"
                  onChange={handleFolderUpload}
                  className="hidden"
                  {...({ webkitdirectory: 'true', directory: 'true' } as Record<string, string>)}
                />
              </label>
            </div>
          </div>

          {/* Batch Progress Bar */}
          {batchProgress && (() => {
            const { current, total, startTime } = batchProgress;
            const percent = total > 0 ? Math.round((current / total) * 100) : 0;
            return (
              <div className="w-full flex items-center gap-3 mt-2">
                <div className="flex-1">
                  <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ease-out rounded-full ${
                        isPaused
                          ? 'bg-gradient-to-r from-amber-500 to-orange-500'
                          : 'bg-gradient-to-r from-violet-500 to-fuchsia-500'
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs whitespace-nowrap">
                  <span className="text-violet-300 font-bold">{current}/{total}</span>
                  <span className="text-gray-500">({percent}%)</span>
                  {!isPaused && getEtaString(batchProgress) && (
                    <span className="text-amber-400">剩余 {getEtaString(batchProgress)}</span>
                  )}
                </div>
              </div>
            );
          })()}
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 z-10 scrollbar-thin scroll-container">
          {folderGroups.length === 0 ? (
            /* Empty State */
            <div className="h-full flex flex-col items-center justify-center text-gray-500 border-2 border-dashed border-gray-800 rounded-3xl bg-gray-900/30 m-4">
              <div className="p-8 bg-gray-900 rounded-full mb-6">
                <Film className="w-12 h-12 text-violet-500" />
              </div>
              <h2 className="text-2xl font-semibold text-gray-300 mb-2">拖放图片或文件夹到这里</h2>
              <p className="max-w-md text-center text-gray-500">
                上传一个文件夹，其中每个子文件夹的图片将被合成为一个 MP4 视频。视频会保存在对应的子文件夹中与图片放在一起，下载 ZIP 包中每个子文件夹包含图片和视频。
              </p>
              <div className="mt-8 flex gap-4">
                <label className="px-8 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-xl cursor-pointer font-medium transition-transform hover:scale-105">
                  选择文件
                  <input type="file" multiple accept="image/*" onChange={handleFileUpload} className="hidden" />
                </label>
                <label className="px-8 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl cursor-pointer font-medium transition-transform hover:scale-105 flex items-center gap-2">
                  <FolderOpen className="w-5 h-5" /> 选择文件夹
                  <input
                    type="file"
                    onChange={handleFolderUpload}
                    className="hidden"
                    {...({ webkitdirectory: 'true', directory: 'true' } as Record<string, string>)}
                  />
                </label>
              </div>
            </div>
          ) : (
            <>
              {/* Breadcrumb Navigation */}
              {folderTree.children.length > 0 && (
                <div className="flex items-center gap-1.5 mb-4 text-xs flex-wrap">
                  <button
                    onClick={() => setVideoCurrentFolderPath(null)}
                    className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
                      !videoCurrentFolderPath
                        ? 'bg-violet-600/30 text-violet-300 font-medium'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                    }`}
                  >
                    <Folder className="w-3.5 h-3.5" />
                    根目录
                  </button>
                  {videoBreadcrumbSegments.map((seg, idx) => (
                    <React.Fragment key={seg.fullPath}>
                      <ChevronRight className="w-3 h-3 text-gray-600" />
                      <button
                        onClick={() => setVideoCurrentFolderPath(seg.fullPath)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
                          idx === videoBreadcrumbSegments.length - 1
                            ? 'bg-violet-600/30 text-violet-300 font-medium'
                            : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
                        }`}
                      >
                        <Folder className="w-3 h-3" />
                        {seg.name}
                      </button>
                    </React.Fragment>
                  ))}
                  <span className="text-gray-600 ml-2">({currentVideoFolderNode.imageCount} 张图片)</span>
                </div>
              )}

              {/* Subfolder Navigation Cards */}
              {currentVideoFolderNode.children.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3 mb-6">
                  {currentVideoFolderNode.children
                    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
                    .map((child) => {
                      // Check if this child folder has any completed videos
                      const childGroups = folderGroups.filter(g =>
                        g.path === child.fullPath || g.path.startsWith(child.fullPath + '/')
                      );
                      const completedCount = childGroups.filter(g => g.isCompleted).length;
                      const totalCount = childGroups.length;

                      return (
                        <button
                          key={child.fullPath}
                          onClick={() => setVideoCurrentFolderPath(child.fullPath)}
                          className="group flex flex-col items-center justify-center p-4 rounded-xl bg-gray-800/60 border border-gray-700/50 hover:border-violet-500/50 hover:bg-gray-800 transition-all cursor-pointer image-card"
                        >
                          <Folder className="w-8 h-8 text-violet-400 mb-2 group-hover:scale-110 transition-transform" />
                          <div className="text-xs font-medium text-gray-300 truncate w-full text-center">{child.name}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5">{child.imageCount} 张图片</div>
                          {totalCount > 0 && (
                            <div className="text-[10px] mt-1">
                              {completedCount === totalCount ? (
                                <span className="text-green-400">✓ 全部完成</span>
                              ) : (
                                <span className="text-amber-400">{completedCount}/{totalCount} 完成</span>
                              )}
                            </div>
                          )}
                          {child.children.length > 0 && (
                            <div className="text-[10px] text-gray-600 mt-0.5">{child.children.length} 个子文件夹</div>
                          )}
                        </button>
                      );
                    })}
                </div>
              )}

              {/* Leaf Folder Groups (video generation targets) */}
              {visibleFolderGroups.length > 0 && (
                <>
                  {currentVideoFolderNode.children.length > 0 && (
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-px flex-1 bg-gray-800"></div>
                      <span className="text-xs text-gray-600">视频合成目标</span>
                      <div className="h-px flex-1 bg-gray-800"></div>
                    </div>
                  )}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4 mb-6">
                    {visibleFolderGroups.map((group) => {
                      const hasVideo = group.isCompleted && group.videoUrl;
                      return (
                        <div
                          key={group.path}
                          className={`group flex flex-col rounded-xl overflow-hidden transition-all image-card ${
                            selectedFolderPath === group.path
                              ? 'bg-gray-800 border-2 border-violet-500 shadow-lg shadow-violet-900/20'
                              : 'bg-gray-800/80 border border-gray-700/60 hover:border-violet-500/50'
                          }`}
                        >
                          {/* Folder Preview */}
                          <button
                            onClick={() => setSelectedFolderPath(selectedFolderPath === group.path ? null : group.path)}
                            className="aspect-square bg-gray-900 flex items-center justify-center overflow-hidden relative w-full cursor-pointer"
                          >
                            {group.images.length > 0 ? (
                              <img
                                src={group.images[0].url}
                                className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity"
                                alt={group.name}
                              />
                            ) : (
                              <Folder className="w-12 h-12 text-gray-600" />
                            )}
                            <div className="absolute inset-0 bg-gradient-to-t from-gray-900/80 via-transparent to-transparent" />

                            {/* Video status badge */}
                            {group.isGenerating && !isPaused && (
                              <div className="absolute inset-0 bg-gray-900/70 backdrop-blur-sm flex flex-col items-center justify-center z-10">
                                <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                                {group.progress && (
                                  <span className="text-white text-[10px] font-medium">{group.progress.percent}%</span>
                                )}
                              </div>
                            )}

                            {/* 暂停状态 */}
                            {group.isGenerating && isPaused && (
                              <div className="absolute inset-0 bg-gray-900/70 backdrop-blur-sm flex flex-col items-center justify-center z-10">
                                <Pause className="w-8 h-8 text-amber-400 mb-1" />
                                <span className="text-amber-300 text-[10px] font-medium">已暂停</span>
                              </div>
                            )}

                            {hasVideo && (
                              <div className="absolute top-2 left-2 bg-green-500/90 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-sm z-10 flex items-center gap-1">
                                <Check className="w-2.5 h-2.5" />
                                MP4
                              </div>
                            )}

                            {group.error && (
                              <div className="absolute top-2 left-2 bg-red-500/90 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-sm z-10">
                                失败
                              </div>
                            )}

                            {group.images.length < 2 && (
                              <div className="absolute top-2 left-2 bg-amber-500/90 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-sm z-10">
                                不足2张
                              </div>
                            )}

                            {/* Download button overlay */}
                            {hasVideo && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDownloadVideoOnly(group); }}
                                className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-black/50 hover:bg-emerald-600 text-green-400 hover:text-white flex items-center justify-center transition-all z-20 opacity-0 group-hover:opacity-100"
                                title="下载视频文件"
                              >
                                {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                              </button>
                            )}

                            {/* View video button overlay */}
                            {hasVideo && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setSelectedFolderPath(group.path); }}
                                className="absolute bottom-8 right-2 w-8 h-8 rounded-lg bg-black/50 hover:bg-fuchsia-600 text-fuchsia-400 hover:text-white flex items-center justify-center transition-all z-20 opacity-0 group-hover:opacity-100"
                                title="预览视频"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                            )}

                            <div className="absolute bottom-2 left-2 right-2 flex items-center gap-1.5">
                              <Folder className="w-4 h-4 text-violet-400 flex-shrink-0" />
                              <span className="text-white text-xs font-medium truncate drop-shadow-lg">{group.name}</span>
                            </div>
                          </button>

                          {/* Folder Info */}
                          <div className="p-2.5 flex items-center justify-between">
                            <span className="text-xs text-gray-400 truncate">
                              {group.images.length} 张图片
                            </span>
                            {hasVideo && group.videoBlob && (
                              <span className="text-[10px] text-green-400">{formatBytes(group.videoBlob.size)}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Selected Folder Detail */}
              {selectedFolder && (
                <div className="mt-6 border-t border-gray-800 pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-violet-400" />
                      <span className="text-sm font-medium text-gray-300">{selectedFolder.name}</span>
                      <span className="text-xs text-gray-500">({selectedFolder.images.length} 张图片)</span>
                      {selectedFolder.path && selectedFolder.path !== selectedFolder.name && (
                        <span className="text-xs text-gray-600 font-mono">路径: {selectedFolder.path}</span>
                      )}
                    </div>
                    {selectedFolder.isCompleted && selectedFolder.videoBlob && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleDownloadVideoOnly(selectedFolder)}
                          className="px-3 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors flex items-center gap-1.5"
                        >
                          <Video className="w-3.5 h-3.5" /> 仅下载视频
                        </button>
                        <button
                          onClick={() => handleDownloadFolder(selectedFolder)}
                          disabled={isDownloading}
                          className="px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Package className="w-3.5 h-3.5" />} 下载 (图片+视频)
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Video Preview - 已完成的视频随时可以查看 */}
                  {selectedFolder.isCompleted && selectedFolder.videoUrl ? (
                    <div className="mb-6">
                      <div
                        className="relative bg-black rounded-xl overflow-hidden shadow-2xl max-w-2xl"
                        style={{ aspectRatio: `${resolution.width}/${resolution.height}` }}
                      >
                        <video
                          src={selectedFolder.videoUrl}
                          controls
                          className="w-full h-full"
                          autoPlay
                          loop
                        />
                      </div>
                      {selectedFolder.videoBlob && (
                        <div className="mt-2 flex items-center gap-3">
                          <p className="text-xs text-gray-500">
                            文件大小: {formatBytes(selectedFolder.videoBlob.size)}
                          </p>
                          <p className="text-xs text-blue-400/70">
                            格式: {getOutputExtension().toUpperCase()}
                          </p>
                        </div>
                      )}
                    </div>
                  ) : selectedFolder.isGenerating ? (
                    <div className="mb-6 flex flex-col items-center justify-center py-12">
                      {isPaused ? (
                        <>
                          <Pause className="w-16 h-16 text-amber-400 mb-4" />
                          <p className="text-amber-300 text-sm font-medium">生成已暂停</p>
                          <p className="text-gray-500 text-xs mt-1">点击"继续"按钮恢复生成</p>
                        </>
                      ) : (
                        <>
                          <div className="w-16 h-16 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                          <p className="text-gray-400 text-sm">
                            {selectedFolder.progress?.phase === 'preparing' && '准备视频生成...'}
                            {selectedFolder.progress?.phase === 'rendering' && `正在渲染帧... ${selectedFolder.progress?.percent || 0}%`}
                            {selectedFolder.progress?.phase === 'encoding' && '正在编码视频...'}
                          </p>
                        </>
                      )}
                    </div>
                  ) : null}

                  {/* Error Display */}
                  {selectedFolder.error && (
                    <div className="mb-6 bg-red-900/20 border border-red-800/30 rounded-xl p-4 flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-red-300 text-sm font-medium">视频生成失败</p>
                        <p className="text-red-400/80 text-xs mt-1">{selectedFolder.error}</p>
                      </div>
                    </div>
                  )}

                  {/* Image Thumbnails */}
                  <div className="space-y-2">
                    <div className="text-xs text-gray-500 mb-2">图片列表:</div>
                    <div className="flex gap-2 overflow-x-auto scrollbar-none pb-2">
                      {selectedFolder.images.map((img, index) => (
                        <div
                          key={img.id}
                          className="shrink-0 w-16 h-16 rounded-lg border-2 border-gray-700 overflow-hidden hover:border-violet-400 transition-colors relative group"
                        >
                          <img src={img.url} className="w-full h-full object-cover" alt="" />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <span className="text-[10px] text-white font-bold">{index + 1}</span>
                          </div>
                          {index < selectedFolder.images.length - 1 && (
                            <div className="absolute -right-1 top-1/2 -translate-y-1/2 bg-violet-500 text-white rounded-full w-3 h-3 flex items-center justify-center z-10">
                              <span className="text-[6px]">→</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
