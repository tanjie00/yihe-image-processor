import React, { useRef, useState, useEffect } from 'react';
import { LogoItem, LogoSettings } from '../types';
import { Move, Maximize, Minimize, Eye, Upload, X, Check, GripVertical, Plus, FolderOpen } from 'lucide-react';

interface LogoControlsProps {
  logoItems: LogoItem[];
  settings: LogoSettings;
  onSettingsChange: (settings: LogoSettings) => void;
  onLogosUpload: (files: File[]) => void;
  onLogoRemove: (id: string) => void;
  onLogoReorder: (fromIndex: number, toIndex: number) => void;
  previewImageUrl: string | null;
}

export const LogoControls: React.FC<LogoControlsProps> = ({
  logoItems,
  settings,
  onSettingsChange,
  onLogosUpload,
  onLogoRemove,
  onLogoReorder,
  previewImageUrl,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [imageAspectRatio, setImageAspectRatio] = useState(16 / 9);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Preview logo: first in the list
  const previewLogoUrl = logoItems.length > 0 ? logoItems[0].url : null;

  // Update aspect ratio when image changes
  useEffect(() => {
    if (!previewImageUrl) return;
    const img = new Image();
    img.onload = () => {
        if (img.naturalHeight > 0) {
            setImageAspectRatio(img.naturalWidth / img.naturalHeight);
        }
    };
    img.src = previewImageUrl;
  }, [previewImageUrl]);

  // File input handler — filter non-image files (e.g. .DS_Store)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const allFiles = Array.from(e.target.files) as File[];
      const imageFiles = allFiles.filter(
        f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|tiff?|gif|avif|svg)$/i.test(f.name)
      );
      if (imageFiles.length > 0) {
        onLogosUpload(imageFiles);
      }
      e.target.value = '';
    }
  };

  // Drag reorder handlers
  const handleListDragStart = (index: number) => setDragIdx(index);

  const handleListDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setOverIdx(index);
  };

  const handleListDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIdx !== null && dragIdx !== index) {
      onLogoReorder(dragIdx, index);
    }
    setDragIdx(null);
    setOverIdx(null);
  };

  const handleListDragEnd = () => {
    setDragIdx(null);
    setOverIdx(null);
  };

  // Unified drag handler for position editor
  const handleDrag = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const container = e.currentTarget as HTMLDivElement;
    const rect = container.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const x = Math.min(Math.max(0, clientX - rect.left), rect.width);
    const y = Math.min(Math.max(0, clientY - rect.top), rect.height);
    onSettingsChange({
      ...settings,
      x: (x / rect.width) * 100,
      y: (y / rect.height) * 100,
    });
  };

  const handleMouseDown = () => setIsDragging(true);

  useEffect(() => {
    const handleGlobalMouseUp = () => setIsDragging(false);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('touchend', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('touchend', handleGlobalMouseUp);
    };
  }, []);

  const handleContainerMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (isDragging) handleDrag(e);
  };

  // Reusable editor area
  const renderEditorArea = (isLargeMode: boolean) => (
    <div
        className={`${isLargeMode ? 'w-full h-full' : 'w-full h-48'} bg-gray-900/80 rounded-xl overflow-hidden border border-white/[0.06] flex items-center justify-center select-none`}
    >
        {previewImageUrl ? (
             <div
                className="relative shadow-2xl cursor-crosshair group"
                style={{
                    aspectRatio: imageAspectRatio,
                    maxWidth: '100%',
                    maxHeight: '100%'
                }}
                onMouseMove={handleContainerMove}
                onMouseDown={handleMouseDown}
                onTouchMove={handleContainerMove}
                onTouchStart={handleMouseDown}
                onMouseLeave={() => setIsDragging(false)}
             >
                <img
                    src={previewImageUrl}
                    alt="Preview Background"
                    className="w-full h-full object-cover block pointer-events-none"
                    draggable={false}
                />

                {previewLogoUrl && (
                    <div
                    style={{
                        left: `${settings.x}%`,
                        top: `${settings.y}%`,
                        width: `${settings.scale}%`,
                        opacity: settings.opacity,
                        position: 'absolute',
                        transform: 'translate(-0%, -0%)',
                    }}
                    className="pointer-events-none"
                    >
                    <img src={previewLogoUrl} alt="Logo" className="w-full h-auto block" draggable={false} />
                    <div className={`absolute inset-0 border-2 border-indigo-400 border-dashed transition-opacity ${isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                    </div>
                )}

                {isLargeMode && (
                    <div className="absolute inset-0 pointer-events-none opacity-20">
                        <div className="w-full h-1/2 border-b border-white absolute top-0"></div>
                        <div className="h-full w-1/2 border-r border-white absolute left-0"></div>
                    </div>
                )}
             </div>
        ) : (
            <div className="text-gray-600 text-sm pointer-events-none">
                无预览图片
            </div>
        )}
    </div>
  );

  const renderSliders = () => (
    <div className="space-y-4 pt-2">
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-gray-400">
          <span className="flex items-center gap-1"><Maximize className="w-3 h-3"/> 大小</span>
          <span>{Math.round(settings.scale)}%</span>
        </div>
        <input
          type="range"
          min="1"
          max="100"
          value={settings.scale}
          onChange={(e) => onSettingsChange({ ...settings, scale: Number(e.target.value) })}
          className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-indigo-500"
        />
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-xs text-gray-400">
          <span className="flex items-center gap-1"><Eye className="w-3 h-3"/> 不透明度</span>
          <span>{Math.round(settings.opacity * 100)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={settings.opacity}
          onChange={(e) => onSettingsChange({ ...settings, opacity: Number(e.target.value) })}
          className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-indigo-500"
        />
      </div>

       <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
                 <label className="text-gray-500">水平位置 X (%)</label>
                 <input
                    type="number"
                    value={Math.round(settings.x)}
                    onChange={(e) => onSettingsChange({ ...settings, x: Number(e.target.value) })}
                    className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1 text-white focus:border-indigo-500/50 focus:shadow-[0_0_8px_-2px_rgba(99,102,241,0.2)]"
                 />
            </div>
            <div>
                 <label className="text-gray-500">垂直位置 Y (%)</label>
                 <input
                    type="number"
                    value={Math.round(settings.y)}
                    onChange={(e) => onSettingsChange({ ...settings, y: Number(e.target.value) })}
                    className="w-full bg-white/[0.05] border border-white/[0.08] rounded-lg px-2 py-1 text-white focus:border-indigo-500/50 focus:shadow-[0_0_8px_-2px_rgba(99,102,241,0.2)]"
                 />
            </div>
       </div>
    </div>
  );

  return (
    <>
        <div className="space-y-4">
          {/* Multi-file & Folder Upload Area */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept="image/*"
              multiple
              onChange={handleFileChange}
            />
            {/* Hidden folder input — webkitdirectory triggers folder picker */}
            <input
              ref={folderInputRef}
              type="file"
              className="hidden"
              onChange={handleFileChange}
              {...({ webkitdirectory: 'true', directory: 'true' } as Record<string, string>)}
            />
            <div className="flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 flex flex-col items-center justify-center py-4 border border-white/[0.08] border-dashed rounded-xl cursor-pointer hover:bg-white/[0.04] hover:border-indigo-500/30 transition-all duration-200 group"
              >
                <Plus className="w-5 h-5 mb-1 text-indigo-400/60 group-hover:text-indigo-400" />
                <p className="text-xs text-gray-400">选择文件</p>
              </button>
              <button
                onClick={() => folderInputRef.current?.click()}
                className="flex-1 flex flex-col items-center justify-center py-4 border border-white/[0.08] border-dashed rounded-xl cursor-pointer hover:bg-white/[0.04] hover:border-indigo-500/30 transition-all duration-200 group"
              >
                <FolderOpen className="w-5 h-5 mb-1 text-indigo-400/60 group-hover:text-indigo-400" />
                <p className="text-xs text-gray-400">选择文件夹</p>
              </button>
            </div>
          </div>

          {/* Logo List with drag-to-reorder */}
          {logoItems.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs text-gray-500 flex items-center justify-between">
                <span>已上传 {logoItems.length} 个 Logo</span>
                <span className="text-gray-600">拖拽排序</span>
              </div>
              <div className="space-y-1 max-h-40 overflow-y-auto scrollbar-thin">
                {logoItems.map((logo, index) => (
                  <div
                    key={logo.id}
                    draggable
                    onDragStart={() => handleListDragStart(index)}
                    onDragOver={(e) => handleListDragOver(e, index)}
                    onDrop={(e) => handleListDrop(e, index)}
                    onDragEnd={handleListDragEnd}
                    className={`flex items-center gap-2 p-1.5 rounded-lg border transition-all cursor-move ${
                      overIdx === index ? 'border-indigo-400/60 bg-indigo-500/10' : 'border-white/[0.06] bg-white/[0.03]'
                    } ${dragIdx === index ? 'opacity-40' : ''}`}
                  >
                    <GripVertical className="w-3.5 h-3.5 text-gray-500 flex-shrink-0 cursor-grab" />
                    <img src={logo.url} className="w-7 h-7 object-contain rounded bg-gray-700 flex-shrink-0 p-0.5" alt="" />
                    <span className="text-xs text-gray-300 truncate flex-1">{logo.name}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); onLogoRemove(logo.id); }}
                      className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-500/10 flex-shrink-0"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Small Visual Editor (Sidebar) */}
          <div className="space-y-2 relative">
            <div className="flex justify-between items-center text-xs text-gray-400">
              <span>可视化定位{logoItems.length > 1 ? ` (预览第 1 个，共 ${logoItems.length} 个)` : ''}</span>
              <button
                  onClick={() => setIsExpanded(true)}
                  className="flex items-center gap-1 text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                  <Maximize className="w-3 h-3" />
                  放大调整
              </button>
            </div>

            {renderEditorArea(false)}
          </div>

          {/* Sliders (Sidebar) */}
          {previewLogoUrl && renderSliders()}
        </div>

        {/* Expanded Modal */}
        {isExpanded && (
            <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex items-center justify-center p-4 md:p-10 animate-fade-in">
                <div className="bg-gray-900/95 w-full max-w-6xl h-full md:h-[90vh] rounded-2xl border border-white/[0.08] shadow-2xl backdrop-blur-xl flex flex-col md:flex-row overflow-hidden">

                    <div className="flex-1 relative bg-gray-950 p-4 flex flex-col">
                        <div className="flex justify-between items-center mb-4 md:hidden">
                            <h3 className="text-white font-bold">精细调整模式</h3>
                            <button onClick={() => setIsExpanded(false)} className="text-gray-400"><X /></button>
                        </div>

                        <div className="flex-1 relative rounded-xl overflow-hidden border border-gray-800 flex items-center justify-center">
                             {renderEditorArea(true)}
                        </div>

                        <div className="text-center text-gray-500 text-xs mt-2">
                             拖动 Logo 进行精细定位
                        </div>
                    </div>

                    <div className="w-full md:w-80 bg-gray-800/60 p-6 flex flex-col border-l border-white/[0.06] overflow-y-auto">
                        <div className="flex justify-between items-center mb-8">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <Move className="w-6 h-6 text-indigo-400" />
                                调整参数
                            </h3>
                            <button
                                onClick={() => setIsExpanded(false)}
                                className="p-2 hover:bg-gray-700 rounded-lg transition-colors hidden md:block"
                            >
                                <Minimize className="w-5 h-5 text-gray-400" />
                            </button>
                        </div>

                        {previewLogoUrl && renderSliders()}

                        <div className="mt-auto pt-8">
                            <button
                                onClick={() => setIsExpanded(false)}
                                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-medium shadow-lg shadow-indigo-500/25 flex items-center justify-center gap-2"
                            >
                                <Check className="w-5 h-5" />
                                完成调整
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}
    </>
  );
};
