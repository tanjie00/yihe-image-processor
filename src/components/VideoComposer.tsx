'use client';

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  Upload, Play, Download, Trash2, Settings2, Film, Image as ImageIcon,
  GripVertical, X, Loader2, Check, Video, FolderOpen, Pause, RotateCcw,
  Eye, MoveHorizontal, Sparkles, Clock, Ratio, Layers
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  generateVideo,
  getAspectRatioResolution,
  TRANSITION_LABELS,
} from '@/lib/video/videoService';
import type {
  VideoAspectRatio,
  TransitionTypeName,
  VideoSettings,
  VideoProgress,
} from '@/lib/video/types';

// ==================== 类型定义 ====================

interface ImageItem {
  id: string;
  file: File;
  url: string;
  name: string;
}

interface FolderGroup {
  name: string;
  path: string;
  images: ImageItem[];
}

const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  aspectRatio: '16:9',
  fps: 30,
  imageDuration: 3,
  transitionDuration: 1,
  transition: 'fade',
  quality: 0.8,
};

const ASPECT_RATIO_OPTIONS: { value: VideoAspectRatio; label: string; icon: string }[] = [
  { value: '16:9', label: '16:9 横屏', icon: '📺' },
  { value: '9:16', label: '9:16 竖屏', icon: '📱' },
  { value: '4:3', label: '4:3 标准', icon: '🖥️' },
  { value: '1:1', label: '1:1 方形', icon: '⬜' },
  { value: '3:4', label: '3:4 竖版', icon: '📋' },
  { value: 'custom', label: '自定义', icon: '⚙️' },
];

const TRANSITION_CATEGORIES = [
  {
    group: '基础效果',
    items: ['fade'] as TransitionTypeName[],
  },
  {
    group: '滑动效果',
    items: ['slideLeft', 'slideRight', 'slideUp', 'slideDown'] as TransitionTypeName[],
  },
  {
    group: '创意效果',
    items: ['circleZoom', 'dissolve', 'granular'] as TransitionTypeName[],
  },
  {
    group: '遮挡效果',
    items: ['blindsH', 'blindsV', 'coverLeft', 'coverRight'] as TransitionTypeName[],
  },
];

export function VideoComposer() {
  // ==================== 状态 ====================
  const [allImages, setAllImages] = useState<ImageItem[]>([]);
  const [folderGroups, setFolderGroups] = useState<FolderGroup[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>('');
  const [videoSettings, setVideoSettings] = useState<VideoSettings>(DEFAULT_VIDEO_SETTINGS);
  const [customWidth, setCustomWidth] = useState(1920);
  const [customHeight, setCustomHeight] = useState(1080);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<VideoProgress | null>(null);
  const [videoBlob, setVideoBlob] = useState<Blob | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number>(0);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // ==================== 文件处理 ====================

  const generateId = () => Math.random().toString(36).substring(2, 11);

  const isValidImage = (file: File) =>
    file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name);

  const getRelativePath = (file: File): string => {
    const rel = (file as any).webkitRelativePath as string;
    if (rel && rel.includes('/')) {
      return rel.substring(0, rel.lastIndexOf('/'));
    }
    return '';
  };

  const processFiles = useCallback((files: FileList | File[]) => {
    const validFiles = Array.from(files).filter(
      (f) => isValidImage(f) && !f.name.startsWith('.') && !f.name.includes('__MACOSX')
    );

    if (validFiles.length === 0) return;

    const newImages: ImageItem[] = validFiles.map((file) => ({
      id: generateId(),
      file,
      url: URL.createObjectURL(file),
      name: file.name,
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

  // 拖拽上传
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
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

  // ==================== 文件夹分组 ====================

  useEffect(() => {
    const groups: Map<string, ImageItem[]> = new Map();
    groups.set('全部图片', []);

    for (const img of allImages) {
      const relPath = getRelativePath(img.file);
      const folderName = relPath || '根目录';

      if (!groups.has(folderName)) {
        groups.set(folderName, []);
      }
      groups.get(folderName)!.push(img);
      groups.get('全部图片')!.push(img);
    }

    const folderArray: FolderGroup[] = [];
    groups.forEach((images, name) => {
      folderArray.push({
        name: name === '全部图片' ? '全部图片' : name,
        path: name,
        images,
      });
    });

    // 确保全部图片在最前面
    folderArray.sort((a, b) => {
      if (a.name === '全部图片') return -1;
      if (b.name === '全部图片') return 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });

    setFolderGroups(folderArray);
    if (folderArray.length > 0 && !selectedFolder) {
      setSelectedFolder('全部图片');
    }
  }, [allImages]);

  const currentImages = useMemo(() => {
    const group = folderGroups.find((g) => g.name === selectedFolder);
    return group?.images || [];
  }, [folderGroups, selectedFolder]);

  // ==================== 图像排序 ====================

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const handleImageReorder = (from: number, to: number) => {
    setAllImages((prev) => {
      const current = currentImages;
      const globalFrom = allImages.indexOf(current[from]);
      const globalTo = allImages.indexOf(current[to]);
      const next = [...prev];
      const [moved] = next.splice(globalFrom, 1);
      next.splice(globalTo, 0, moved);
      return next;
    });
  };

  const handleRemoveImage = (id: string) => {
    setAllImages((prev) => {
      const target = prev.find((img) => img.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((img) => img.id !== id);
    });
  };

  const handleClearAll = () => {
    allImages.forEach((img) => URL.revokeObjectURL(img.url));
    setAllImages([]);
    setFolderGroups([]);
    setSelectedFolder('');
    setVideoBlob(null);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
  };

  // ==================== 视频生成 ====================

  const handleGenerate = async () => {
    if (currentImages.length < 2) return;

    setIsGenerating(true);
    setVideoBlob(null);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      // 加载所有图片为 HTMLImageElement
      const imageElements: HTMLImageElement[] = [];
      for (const img of currentImages) {
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

      const blob = await generateVideo(imageElements, settings, setProgress, abortController.signal);

      setVideoBlob(blob);
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        alert(`视频生成失败: ${err.message}`);
      }
    } finally {
      setIsGenerating(false);
      setProgress(null);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleDownload = () => {
    if (!videoBlob || !videoUrl) return;
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `video_${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // ==================== 预览转场效果 ====================

  const [transitionPreviewUrl, setTransitionPreviewUrl] = useState<string | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const handlePreviewTransition = useCallback(async () => {
    if (currentImages.length < 2) return;

    const canvas = document.createElement('canvas');
    previewCanvasRef.current = canvas;
    const res = getAspectRatioResolution(
      videoSettings.aspectRatio,
      videoSettings.customWidth,
      videoSettings.customHeight
    );
    canvas.width = res.width;
    canvas.height = res.height;
    const ctx = canvas.getContext('2d')!;

    // 加载前两张图片
    const imgs: HTMLImageElement[] = [];
    for (let i = 0; i < Math.min(2, currentImages.length); i++) {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      await new Promise<void>((resolve) => {
        el.onload = () => resolve();
        el.src = currentImages[i].url;
      });
      imgs.push(el);
    }

    // 使用 transitions 模块来预览
    const { TRANSITIONS, drawImageCover } = await import('@/lib/video/transitions');

    const transitionFn = TRANSITIONS[videoSettings.transition];
    let animFrame = 0;
    const totalFrames = 60;

    const animate = () => {
      if (!previewCanvasRef.current) return;
      const p = animFrame / totalFrames;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      transitionFn(ctx, imgs[0], imgs[1], p, canvas.width, canvas.height);
      setTransitionPreviewUrl(canvas.toDataURL('image/png', 0.5));
      animFrame++;
      if (animFrame <= totalFrames) {
        requestAnimationFrame(animate);
      }
    };

    animate();
  }, [currentImages, videoSettings]);

  // 清理
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, []);

  // ==================== 计算 ====================

  const resolution = useMemo(
    () => getAspectRatioResolution(videoSettings.aspectRatio, customWidth, customHeight),
    [videoSettings.aspectRatio, customWidth, customHeight]
  );

  const estimatedDuration = useMemo(() => {
    const count = currentImages.length;
    if (count < 2) return 0;
    return count * videoSettings.imageDuration + (count - 1) * videoSettings.transitionDuration;
  }, [currentImages.length, videoSettings.imageDuration, videoSettings.transitionDuration]);

  const estimatedSize = useMemo(() => {
    const count = currentImages.length;
    if (count < 2) return 0;
    const pixels = resolution.width * resolution.height;
    const bitrate = pixels * videoSettings.fps * 0.1 * (0.5 + videoSettings.quality * 1.5);
    return (bitrate * estimatedDuration) / 8;
  }, [resolution, videoSettings, estimatedDuration]);

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

  // ==================== 渲染 ====================

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* 顶部标题栏 */}
      <header className="border-b border-border bg-card px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
            <Video className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">CleanSlate AI 视频</h1>
            <p className="text-sm text-muted-foreground">图片合成视频 · 转场特效工具</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-xs">
            {currentImages.length} 张图片
          </Badge>
          <Badge variant="outline" className="text-xs">
            {resolution.width}×{resolution.height}
          </Badge>
        </div>
      </header>

      {/* 主体区域 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧 - 图片管理 */}
        <div className="w-80 border-r border-border bg-card flex flex-col shrink-0">
          {/* 上传区域 */}
          <div className="p-4 space-y-3 border-b border-border">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <ImageIcon className="w-4 h-4" />
                图片素材
              </h2>
              {allImages.length > 0 && (
                <Button variant="ghost" size="sm" onClick={handleClearAll} className="text-destructive text-xs h-7">
                  <Trash2 className="w-3 h-3 mr-1" />
                  清空
                </Button>
              )}
            </div>

            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
                isDragging
                  ? 'border-violet-500 bg-violet-500/10'
                  : 'border-border hover:border-violet-400 hover:bg-muted/50'
              }`}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm font-medium">拖拽或点击上传图片</p>
              <p className="text-xs text-muted-foreground mt-1">支持 JPG/PNG/WebP</p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*"
              multiple
              onChange={handleFileUpload}
            />
            <input
              ref={folderInputRef}
              type="file"
              className="hidden"
              onChange={handleFolderUpload}
              {...({ webkitdirectory: 'true', directory: 'true' } as Record<string, string>)}
            />

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-3 h-3 mr-1" />
                选择文件
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 text-xs"
                onClick={() => folderInputRef.current?.click()}
              >
                <FolderOpen className="w-3 h-3 mr-1" />
                选择文件夹
              </Button>
            </div>
          </div>

          {/* 文件夹选择 */}
          {folderGroups.length > 1 && (
            <div className="px-4 py-3 border-b border-border">
              <Label className="text-xs text-muted-foreground mb-2 block">选择图片组</Label>
              <Select value={selectedFolder} onValueChange={setSelectedFolder}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {folderGroups.map((group) => (
                    <SelectItem key={group.name} value={group.name}>
                      <span className="flex items-center gap-2">
                        {group.name === '全部图片' ? <Layers className="w-3 h-3" /> : <FolderOpen className="w-3 h-3" />}
                        {group.name} ({group.images.length})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* 图片列表 */}
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-2">
              {currentImages.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">暂无图片</p>
                  <p className="text-xs mt-1">上传图片开始制作视频</p>
                </div>
              ) : (
                currentImages.map((img, index) => (
                  <div
                    key={img.id}
                    draggable
                    onDragStart={() => setDragIdx(index)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setOverIdx(index);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIdx !== null && dragIdx !== index) {
                        handleImageReorder(dragIdx, index);
                      }
                      setDragIdx(null);
                      setOverIdx(null);
                    }}
                    onDragEnd={() => {
                      setDragIdx(null);
                      setOverIdx(null);
                    }}
                    className={`flex items-center gap-2 p-2 rounded-lg border transition-all group ${
                      overIdx === index
                        ? 'border-violet-500 bg-violet-500/10'
                        : 'border-border bg-background hover:border-violet-400/50'
                    } ${dragIdx === index ? 'opacity-40' : ''}`}
                  >
                    <GripVertical className="w-3.5 h-3.5 text-muted-foreground cursor-grab shrink-0" />
                    <div className="w-10 h-10 rounded bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                      <img src={img.url} className="w-full h-full object-cover" alt="" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{img.name}</p>
                      <p className="text-[10px] text-muted-foreground">#{index + 1}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="opacity-0 group-hover:opacity-100 h-6 w-6 p-0 text-destructive shrink-0"
                      onClick={() => handleRemoveImage(img.id)}
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* 中间 - 预览区域 */}
        <div className="flex-1 flex flex-col bg-muted/30">
          <div className="flex-1 flex items-center justify-center p-8">
            {isGenerating ? (
              <div className="text-center space-y-6">
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center mx-auto animate-pulse">
                  <Film className="w-10 h-10 text-white" />
                </div>
                <div className="space-y-3 max-w-sm">
                  <p className="text-sm font-medium">
                    {progress?.phase === 'preparing' && '准备视频生成...'}
                    {progress?.phase === 'rendering' && '正在渲染帧...'}
                    {progress?.phase === 'encoding' && '正在编码视频...'}
                  </p>
                  <Progress value={progress?.percent ?? 0} className="h-2" />
                  <p className="text-xs text-muted-foreground">
                    {progress ? `${progress.current} / ${progress.total} 帧 (${progress.percent}%)` : ''}
                  </p>
                  <Button variant="destructive" size="sm" onClick={handleCancel}>
                    <Pause className="w-3 h-3 mr-1" />
                    取消生成
                  </Button>
                </div>
              </div>
            ) : videoUrl ? (
              <div className="w-full max-w-3xl space-y-4">
                <div
                  className="relative bg-black rounded-xl overflow-hidden shadow-2xl"
                  style={{ aspectRatio: `${resolution.width}/${resolution.height}` }}
                >
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    controls
                    className="w-full h-full"
                    autoPlay
                    loop
                  />
                </div>
                <div className="flex items-center justify-center gap-3">
                  <Button onClick={handleDownload} className="bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600">
                    <Download className="w-4 h-4 mr-2" />
                    下载视频 (.webm)
                  </Button>
                  <Button variant="outline" onClick={handleGenerate}>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    重新生成
                  </Button>
                </div>
                {videoBlob && (
                  <p className="text-center text-xs text-muted-foreground">
                    文件大小: {formatBytes(videoBlob.size)} · 时长: {formatDuration(estimatedDuration)}
                  </p>
                )}
              </div>
            ) : (
              <div className="text-center space-y-4">
                <div className="w-24 h-24 rounded-2xl bg-muted flex items-center justify-center mx-auto">
                  <Video className="w-12 h-12 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-lg font-medium">视频预览区</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    上传至少 2 张图片，配置参数后点击生成
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* 底部图片缩略图条 */}
          {currentImages.length > 0 && !isGenerating && !videoUrl && (
            <div className="border-t border-border bg-card px-4 py-3">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {currentImages.map((img, index) => (
                  <div
                    key={img.id}
                    className="shrink-0 w-16 h-16 rounded-lg border-2 border-border overflow-hidden hover:border-violet-400 transition-colors cursor-pointer relative group"
                    onClick={() => setPreviewIndex(index)}
                  >
                    <img src={img.url} className="w-full h-full object-cover" alt="" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <span className="text-[10px] text-white font-bold">{index + 1}</span>
                    </div>
                    {index < currentImages.length - 1 && (
                      <div className="absolute -right-1 top-1/2 -translate-y-1/2 bg-violet-500 text-white rounded-full w-3 h-3 flex items-center justify-center z-10">
                        <span className="text-[6px]">→</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 右侧 - 设置面板 */}
        <div className="w-80 border-l border-border bg-card flex flex-col shrink-0">
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-6">
              {/* 视频比例 */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Ratio className="w-4 h-4 text-violet-500" />
                  视频比例
                </h3>
                <div className="grid grid-cols-3 gap-2">
                  {ASPECT_RATIO_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() =>
                        setVideoSettings((prev) => ({ ...prev, aspectRatio: opt.value }))
                      }
                      className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border text-xs transition-all ${
                        videoSettings.aspectRatio === opt.value
                          ? 'border-violet-500 bg-violet-500/10 text-violet-600'
                          : 'border-border hover:border-violet-400/50'
                      }`}
                    >
                      <span className="text-base">{opt.icon}</span>
                      <span className="font-medium">{opt.label}</span>
                    </button>
                  ))}
                </div>

                {videoSettings.aspectRatio === 'custom' && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <Label className="text-xs text-muted-foreground">宽度 (px)</Label>
                      <Input
                        type="number"
                        value={customWidth}
                        onChange={(e) => setCustomWidth(Number(e.target.value))}
                        min={100}
                        max={7680}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">高度 (px)</Label>
                      <Input
                        type="number"
                        value={customHeight}
                        onChange={(e) => setCustomHeight(Number(e.target.value))}
                        min={100}
                        max={4320}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  输出分辨率: {resolution.width}×{resolution.height}
                </p>
              </div>

              <Separator />

              {/* 转场效果 */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-fuchsia-500" />
                  转场效果
                </h3>

                {TRANSITION_CATEGORIES.map((category) => (
                  <div key={category.group} className="space-y-2">
                    <Label className="text-xs text-muted-foreground">{category.group}</Label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {category.items.map((type) => (
                        <button
                          key={type}
                          onClick={() =>
                            setVideoSettings((prev) => ({ ...prev, transition: type }))
                          }
                          className={`px-2.5 py-2 rounded-lg border text-xs font-medium transition-all text-left ${
                            videoSettings.transition === type
                              ? 'border-fuchsia-500 bg-fuchsia-500/10 text-fuchsia-600'
                              : 'border-border hover:border-fuchsia-400/50'
                          }`}
                        >
                          {TRANSITION_LABELS[type]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <Separator />

              {/* 时间设置 */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-500" />
                  时间设置
                </h3>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">每张图片展示时长</Label>
                    <span className="text-xs text-muted-foreground font-mono">
                      {videoSettings.imageDuration}s
                    </span>
                  </div>
                  <Slider
                    value={[videoSettings.imageDuration]}
                    min={1}
                    max={10}
                    step={0.5}
                    onValueChange={([v]) =>
                      setVideoSettings((prev) => ({ ...prev, imageDuration: v }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">转场持续时间</Label>
                    <span className="text-xs text-muted-foreground font-mono">
                      {videoSettings.transitionDuration}s
                    </span>
                  </div>
                  <Slider
                    value={[videoSettings.transitionDuration]}
                    min={0.3}
                    max={3}
                    step={0.1}
                    onValueChange={([v]) =>
                      setVideoSettings((prev) => ({ ...prev, transitionDuration: v }))
                    }
                  />
                </div>
              </div>

              <Separator />

              {/* 质量设置 */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold flex items-center gap-2">
                  <Settings2 className="w-4 h-4 text-emerald-500" />
                  质量设置
                </h3>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">帧率 (FPS)</Label>
                    <span className="text-xs text-muted-foreground font-mono">
                      {videoSettings.fps}
                    </span>
                  </div>
                  <Slider
                    value={[videoSettings.fps]}
                    min={15}
                    max={60}
                    step={5}
                    onValueChange={([v]) =>
                      setVideoSettings((prev) => ({ ...prev, fps: v }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">视频质量</Label>
                    <span className="text-xs text-muted-foreground font-mono">
                      {Math.round(videoSettings.quality * 100)}%
                    </span>
                  </div>
                  <Slider
                    value={[videoSettings.quality]}
                    min={0.3}
                    max={1}
                    step={0.1}
                    onValueChange={([v]) =>
                      setVideoSettings((prev) => ({ ...prev, quality: v }))
                    }
                  />
                </div>
              </div>

              <Separator />

              {/* 视频信息摘要 */}
              {currentImages.length >= 2 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">视频摘要</h3>
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">图片数量</span>
                      <span className="font-mono">{currentImages.length} 张</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">转场次数</span>
                      <span className="font-mono">{currentImages.length - 1} 次</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">转场效果</span>
                      <span className="font-mono">{TRANSITION_LABELS[videoSettings.transition]}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">预估时长</span>
                      <span className="font-mono">{formatDuration(estimatedDuration)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">预估大小</span>
                      <span className="font-mono">{formatBytes(estimatedSize)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* 生成按钮 */}
          <div className="p-4 border-t border-border">
            <Button
              className="w-full bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white font-semibold h-11"
              disabled={currentImages.length < 2 || isGenerating}
              onClick={handleGenerate}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  生成中...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  生成视频
                </>
              )}
            </Button>
            {currentImages.length < 2 && (
              <p className="text-xs text-muted-foreground text-center mt-2">
                至少需要 2 张图片才能生成视频
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
