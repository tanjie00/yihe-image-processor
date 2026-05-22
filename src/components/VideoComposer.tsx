'use client';

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  Upload, Play, Download, Trash2, Film, Image as ImageIcon,
  X, Loader2, Video, FolderOpen, Pause, RotateCcw,
  Sparkles, Clock, Ratio, Layers, Folder, ChevronDown,
  ChevronRight, Check, Settings2, Zap, Eye, Package,
  CheckSquare, Square, AlertCircle, Music, Volume2
} from 'lucide-react';
import {
  generateVideo,
  getAspectRatioResolution,
  TRANSITION_LABELS,
  supportsFastEncoding,
} from '@/lib/video/videoService';
import type {
  VideoAspectRatio,
  TransitionTypeName,
  VideoSettings,
  VideoProgress,
} from '@/lib/video/types';

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

const CONCURRENCY = 3; // Process up to 3 folders simultaneously

const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  aspectRatio: '16:9',
  fps: 30,
  imageDuration: 3,
  transitionDuration: 1,
  transition: 'fade',
  quality: 0.8,
};

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

export function VideoComposer() {
  // ==================== State ====================
  const [allImages, setAllImages] = useState<ImageItem[]>([]);
  const [folderGroups, setFolderGroups] = useState<FolderGroup[]>([]);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);
  const [videoSettings, setVideoSettings] = useState<VideoSettings>(DEFAULT_VIDEO_SETTINGS);
  const [customWidth, setCustomWidth] = useState(1920);
  const [customHeight, setCustomHeight] = useState(1080);
  const [isBatchGenerating, setIsBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; startTime: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Background music state
  const [bgmFile, setBgmFile] = useState<File | null>(null);
  const [bgmVolume, setBgmVolume] = useState(0.5);
  const [bgmPlaying, setBgmPlaying] = useState(false);
  const bgmAudioRef = useRef<HTMLAudioElement | null>(null);
  const bgmInputRef = useRef<HTMLInputElement>(null);

  // Collapsible sections state
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set(['transition', 'time', 'quality', 'bgm']));
  const toggleSection = (section: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };
  const isSectionCollapsed = (section: string) => collapsedSections.has(section);

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

  // ==================== BGM Controls ====================
  const handleBgmUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|aac|flac|wma)$/i.test(file.name)) {
      alert('请上传音频文件 (mp3, wav, ogg, m4a)');
      return;
    }
    setBgmFile(file);
    // Stop any currently playing BGM
    if (bgmAudioRef.current) {
      bgmAudioRef.current.pause();
      bgmAudioRef.current = null;
    }
    setBgmPlaying(false);
    e.target.value = '';
  };

  const toggleBgmPlayback = () => {
    if (!bgmFile) return;
    if (bgmPlaying && bgmAudioRef.current) {
      bgmAudioRef.current.pause();
      setBgmPlaying(false);
    } else {
      if (bgmAudioRef.current) {
        bgmAudioRef.current.pause();
      }
      const audio = new Audio(URL.createObjectURL(bgmFile));
      audio.volume = bgmVolume;
      audio.onended = () => setBgmPlaying(false);
      audio.play();
      bgmAudioRef.current = audio;
      setBgmPlaying(true);
    }
  };

  const removeBgm = () => {
    if (bgmAudioRef.current) {
      bgmAudioRef.current.pause();
      bgmAudioRef.current = null;
    }
    setBgmFile(null);
    setBgmPlaying(false);
  };

  // Cleanup BGM audio on unmount
  useEffect(() => {
    return () => {
      if (bgmAudioRef.current) {
        bgmAudioRef.current.pause();
        bgmAudioRef.current = null;
      }
    };
  }, []);

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
      // Extract the last segment as the display name, preserve full path
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

  // ==================== Video Generation (Concurrent Pool) ====================

  const handleBatchGenerate = async () => {
    if (folderGroups.length === 0) return;

    setIsBatchGenerating(true);
    const abortController = new AbortController();
    abortRef.current = abortController;

    const eligibleGroups = folderGroups.filter(g => g.images.length >= 2);
    const totalFolders = eligibleGroups.length;
    let completedCount = 0;
    let nextIndex = 0;
    const startTime = Date.now();
    setBatchProgress({ current: 0, total: totalFolders, startTime });

    const processNext = async (): Promise<void> => {
      while (nextIndex < eligibleGroups.length) {
        if (abortController.signal.aborted) return;
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
          // Pass background music settings
          if (bgmFile) {
            settings.audioFile = bgmFile;
            settings.audioVolume = bgmVolume;
          }

          const onProgress = (progress: VideoProgress) => {
            setFolderGroups(prev => prev.map(g =>
              g.path === group.path ? { ...g, progress } : g
            ));
          };

          const blob = await generateVideo(imageElements, settings, onProgress, abortController.signal);

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

    // Start concurrent workers (up to CONCURRENCY, but no more than total folders)
    const workerCount = Math.min(CONCURRENCY, eligibleGroups.length);
    const workers = Array.from({ length: workerCount }, () => processNext());
    await Promise.all(workers);

    setIsBatchGenerating(false);
    setBatchProgress(null);
    abortRef.current = null;
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsBatchGenerating(false);
    setBatchProgress(null);
    // Clear isGenerating on any groups still generating (they will be aborted)
    setFolderGroups(prev => prev.map(g =>
      g.isGenerating ? { ...g, isGenerating: false, progress: undefined } : g
    ));
  };

  // ==================== Download ====================

  const handleDownloadVideo = (group: FolderGroup) => {
    if (!group.videoBlob) return;
    // Direct download of the video file (no ZIP)
    const url = URL.createObjectURL(group.videoBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${group.name}_video.webm`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  };

  const handleDownloadFolder = async (group: FolderGroup) => {
    if (!group.videoBlob) {
      alert('视频文件不存在，请重新生成');
      return;
    }
    setIsDownloading(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Add original images - preserve full folder path
      for (const img of group.images) {
        const imgPath = img.relativePath ? `${img.relativePath}/${img.name}` : img.name;
        zip.file(imgPath, img.file);
      }

      // Add video - use full path for folder hierarchy
      const videoPath = group.path ? `${group.path}/${group.name}_video.webm` : `${group.name}_video.webm`;
      zip.file(videoPath, group.videoBlob);

      const blob = await zip.generateAsync({ type: 'blob', streamFiles: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${group.name}.zip`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 500);
    } catch (err) {
      console.error('ZIP failed', err);
      alert('下载失败，请重试: ' + (err instanceof Error ? err.message : '未知错误'));
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadAll = async () => {
    const completedGroups = folderGroups.filter(g => g.isCompleted && g.videoBlob);
    if (completedGroups.length === 0) return;
    if (completedGroups.length === 1) {
      handleDownloadFolder(completedGroups[0]);
      return;
    }

    setIsDownloading(true);
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      for (const group of completedGroups) {
        if (!group.videoBlob) continue;

        // Add original images - preserve full folder path
        for (const img of group.images) {
          const imgPath = img.relativePath ? `${img.relativePath}/${img.name}` : `${group.path}/${img.name}`;
          zip.file(imgPath, img.file);
        }

        // Add video - preserve full folder path
        const videoPath = group.path ? `${group.path}/${group.name}_video.webm` : `${group.name}/${group.name}_video.webm`;
        zip.file(videoPath, group.videoBlob);
      }

      const blob = await zip.generateAsync({ type: 'blob', streamFiles: true });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'videos_batch.zip';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 500);
    } catch (err) {
      console.error('ZIP failed', err);
      alert('下载失败，请重试: ' + (err instanceof Error ? err.message : '未知错误'));
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
  const eligibleFolders = folderGroups.filter(g => g.images.length >= 2).length;

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
          <p className="text-xs text-gray-500 mt-1">批量图片合成视频 · 转场特效</p>
          {supportsFastEncoding && (
            <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-emerald-400/80">
              <Zap className="w-3 h-3" />
              <span>快速编码模式 (VideoEncoder)</span>
            </div>
          )}
        </div>

        {/* Scrollable Sections */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2 scrollbar-thin will-change-scroll-position">

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
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isSectionCollapsed('ratio') ? '' : 'rotate-180'}`} />
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
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isSectionCollapsed('transition') ? '' : 'rotate-180'}`} />
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
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isSectionCollapsed('time') ? '' : 'rotate-180'}`} />
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
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isSectionCollapsed('quality') ? '' : 'rotate-180'}`} />
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

        {/* Background Music - Collapsible */}
        <div className="border border-gray-700/50 rounded-xl overflow-hidden">
          <button
            onClick={() => toggleSection('bgm')}
            className="w-full flex items-center justify-between p-3 hover:bg-gray-800/50 transition-colors"
          >
            <label className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 cursor-pointer">
              <Music className="w-4 h-4 text-pink-400" />
              背景音乐
            </label>
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isSectionCollapsed('bgm') ? '' : 'rotate-180'}`} />
          </button>
          <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isSectionCollapsed('bgm') ? 'max-h-0' : 'max-h-[400px]'}`}>
            <div className="px-3 pb-3 space-y-3">
              {!bgmFile ? (
                <button
                  onClick={() => bgmInputRef.current?.click()}
                  className="w-full py-3 rounded-lg border-2 border-dashed border-gray-600 hover:border-violet-500 text-gray-400 hover:text-violet-300 flex items-center justify-center gap-2 transition-colors text-sm"
                >
                  <Upload className="w-4 h-4" />
                  上传背景音乐
                </button>
              ) : (
                <div className="space-y-3">
                  {/* Audio file info */}
                  <div className="flex items-center gap-2 bg-gray-800 rounded-lg p-2.5">
                    <Music className="w-4 h-4 text-pink-400 flex-shrink-0" />
                    <span className="text-xs text-gray-300 truncate flex-1">{bgmFile.name}</span>
                    <button
                      onClick={toggleBgmPlayback}
                      className="w-7 h-7 rounded-md bg-gray-700 hover:bg-violet-600 text-gray-300 hover:text-white flex items-center justify-center transition-colors flex-shrink-0"
                      title={bgmPlaying ? '暂停' : '试听'}
                    >
                      {bgmPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={removeBgm}
                      className="w-7 h-7 rounded-md bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white flex items-center justify-center transition-colors flex-shrink-0"
                      title="移除"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Volume slider */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-300 flex items-center gap-1.5">
                        <Volume2 className="w-3.5 h-3.5" />
                        音量
                      </span>
                      <span className="text-xs text-gray-500 font-mono">{Math.round(bgmVolume * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={bgmVolume}
                      onChange={e => {
                        const vol = parseFloat(e.target.value);
                        setBgmVolume(vol);
                        if (bgmAudioRef.current) {
                          bgmAudioRef.current.volume = vol;
                        }
                      }}
                      className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-pink-500"
                    />
                  </div>
                </div>
              )}
              <input
                ref={bgmInputRef}
                type="file"
                accept="audio/*,.mp3,.wav,.ogg,.m4a"
                onChange={handleBgmUpload}
                className="hidden"
              />
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
                并发合成中... (×{CONCURRENCY})
              </>
            ) : (
              <>
                <Play className="w-5 h-5 fill-current" />
                批量合成视频 ({eligibleFolders})
              </>
            )}
          </button>
          {isBatchGenerating && (
            <button
              onClick={handleCancel}
              className="w-full py-2 rounded-lg text-sm text-red-400 hover:bg-red-900/20 border border-red-900/30 transition-colors"
            >
              取消生成
            </button>
          )}
          {completedVideos > 0 && (
            <button
              onClick={handleDownloadAll}
              disabled={isDownloading}
              className={`w-full py-2.5 rounded-xl text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white flex items-center justify-center gap-2 transition-colors ${isDownloading ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              {isDownloading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  打包中...
                </>
              ) : (
                <>
                  <Package className="w-4 h-4" />
                  下载全部视频 ({completedVideos})
                </>
              )}
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
        <header className={`border-b border-gray-800 flex items-center justify-between px-6 bg-gray-900/50 backdrop-blur z-20 transition-all ${batchProgress ? 'h-24 flex-col py-2' : 'h-16'}`}>
          <div className="flex items-center gap-4 w-full">
            <span className="text-gray-400 text-sm">
              已加载 {totalImages} 张图片 · {folderGroups.length} 个文件夹
            </span>
            {completedVideos > 0 && (
              <span className="text-green-400 text-sm flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-green-500"></div>
                {completedVideos} 个视频已完成
              </span>
            )}
            {isBatchGenerating && (
              <span className="text-violet-400 text-sm flex items-center gap-1">
                <Zap className="w-3 h-3" />
                并发×{CONCURRENCY}
              </span>
            )}
            {bgmFile && (
              <span className="text-pink-400 text-sm flex items-center gap-1">
                <Music className="w-3 h-3" />
                BGM: {bgmFile.name}
              </span>
            )}
          </div>

          {/* Batch Progress Bar */}
          {batchProgress && (() => {
            const { current, total, startTime } = batchProgress;
            const percent = total > 0 ? Math.round((current / total) * 100) : 0;
            return (
              <div className="w-full flex items-center gap-3">
                <div className="flex-1">
                  <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-violet-500 to-fuchsia-500 h-full transition-all duration-300 ease-out rounded-full"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs whitespace-nowrap">
                  <span className="text-violet-300 font-bold">{current}/{total}</span>
                  <span className="text-gray-500">({percent}%)</span>
                  {getEtaString(batchProgress) && (
                    <span className="text-amber-400">剩余 {getEtaString(batchProgress)}</span>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="flex gap-2">
            {completedVideos > 0 && (
              <button
                onClick={handleDownloadAll}
                disabled={isDownloading}
                className={`px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors flex items-center gap-2 shadow-lg shadow-violet-900/20 ${isDownloading ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                {isDownloading ? '打包中...' : `下载全部 (${completedVideos})`}
              </button>
            )}
            <button
              onClick={handleClearAll}
              className="px-3 py-1.5 text-sm text-red-400 hover:bg-red-900/20 rounded-lg transition-colors flex items-center gap-2"
              disabled={isBatchGenerating}
            >
              <Trash2 className="w-4 h-4"/> 清空所有
            </button>
            <label className="cursor-pointer px-4 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors flex items-center gap-2">
              <Upload className="w-4 h-4"/> 添加图片
              <input type="file" multiple accept="image/*" onChange={handleFileUpload} className="hidden" />
            </label>
            <label className="cursor-pointer px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors flex items-center gap-2">
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
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 z-10 will-change-scroll-position">
          {folderGroups.length === 0 ? (
            /* Empty State */
            <div className="h-full flex flex-col items-center justify-center text-gray-500 border-2 border-dashed border-gray-800 rounded-3xl bg-gray-900/30 m-4">
              <div className="p-8 bg-gray-900 rounded-full mb-6">
                <Film className="w-12 h-12 text-violet-500" />
              </div>
              <h2 className="text-2xl font-semibold text-gray-300 mb-2">拖放图片或文件夹到这里</h2>
              <p className="max-w-md text-center text-gray-500">
                上传一个文件夹，其中每个子文件夹的图片将被合成为一个视频。视频会保存在对应的子文件夹中，原图不会被删除。
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
              {/* Folder Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-4 mb-6">
                {folderGroups.map((group) => {
                  const hasVideo = group.isCompleted && group.videoUrl;
                  return (
                    <div
                      key={group.path}
                      className={`group flex flex-col rounded-xl overflow-hidden transition-all ${
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
                        {group.isGenerating && (
                          <div className="absolute inset-0 bg-gray-900/70 backdrop-blur-sm flex flex-col items-center justify-center z-10">
                            <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mb-2"></div>
                            {group.progress && (
                              <span className="text-white text-[10px] font-medium">{group.progress.percent}%</span>
                            )}
                          </div>
                        )}

                        {hasVideo && (
                          <div className="absolute top-2 left-2 bg-green-500/90 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-sm z-10">
                            已合成
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
                            onClick={(e) => { e.stopPropagation(); handleDownloadVideo(group); }}
                            className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-black/50 hover:bg-violet-600 text-green-400 hover:text-white flex items-center justify-center transition-all z-20 opacity-0 group-hover:opacity-100"
                            title="下载视频 (.webm)"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                        )}

                        <div className="absolute bottom-2 left-2 right-2 flex flex-col gap-0">
                          <div className="flex items-center gap-1.5">
                            <Folder className="w-4 h-4 text-violet-400 flex-shrink-0" />
                            <span className="text-white text-xs font-medium truncate drop-shadow-lg">{group.name}</span>
                          </div>
                          {group.path && group.path.includes('/') && (
                            <span className="text-gray-400 text-[9px] truncate drop-shadow-lg ml-5">{group.path}</span>
                          )}
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

              {/* Selected Folder Detail */}
              {selectedFolder && (
                <div className="mt-6 border-t border-gray-800 pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <FolderOpen className="w-4 h-4 text-violet-400" />
                      <span className="text-sm font-medium text-gray-300">{selectedFolder.name}</span>
                      {selectedFolder.path && selectedFolder.path.includes('/') && (
                        <span className="text-xs text-gray-500">({selectedFolder.path})</span>
                      )}
                      <span className="text-xs text-gray-500">({selectedFolder.images.length} 张图片)</span>
                    </div>
                    {selectedFolder.isCompleted && selectedFolder.videoBlob && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleDownloadVideo(selectedFolder)}
                          className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors flex items-center gap-2"
                        >
                          <Download className="w-4 h-4" /> 下载视频
                        </button>
                        <button
                          onClick={() => handleDownloadFolder(selectedFolder)}
                          disabled={isDownloading}
                          className={`px-3 py-1.5 text-sm bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors flex items-center gap-2 ${isDownloading ? 'opacity-60 cursor-not-allowed' : ''}`}
                        >
                          {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Package className="w-4 h-4" />}
                          {isDownloading ? '打包中...' : '下载 (图片+视频 ZIP)'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Video Preview */}
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
                        <p className="mt-2 text-xs text-gray-500">
                          文件大小: {formatBytes(selectedFolder.videoBlob.size)}
                        </p>
                      )}
                    </div>
                  ) : selectedFolder.isGenerating ? (
                    <div className="mb-6 flex flex-col items-center justify-center py-12">
                      <div className="w-16 h-16 border-4 border-violet-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                      <p className="text-gray-400 text-sm">
                        {selectedFolder.progress?.phase === 'preparing' && '准备视频生成...'}
                        {selectedFolder.progress?.phase === 'rendering' && `正在渲染帧... ${selectedFolder.progress?.percent || 0}%`}
                        {selectedFolder.progress?.phase === 'encoding' && '正在编码视频...'}
                      </p>
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
                    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
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
