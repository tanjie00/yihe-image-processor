import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X, Check, Trash2, ZoomIn, ZoomOut, GripHorizontal, MousePointerClick } from 'lucide-react';
import { SlicedPiece } from '../types';
import { loadElementImage } from '../services/canvasService';

interface NodeData {
  id: string;
  y: number; // percentage 0-100
}

interface CustomSliceModalProps {
  imageUrl: string;
  onClose: () => void;
  onCrop: (pieces: SlicedPiece[]) => void;
  initialNodes?: number[]; // percentage positions for re-editing
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.15;
const MIN_NODE_GAP = 0.3; // minimum gap between nodes in percentage

export function CustomSliceModal({ imageUrl, onClose, onCrop, initialNodes }: CustomSliceModalProps) {
  const [nodes, setNodes] = useState<NodeData[]>(() =>
    (initialNodes ?? []).map((y, i) => ({ id: Math.random().toString(36).substring(2, 11), y }))
  );
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState(1);
  const [isCropping, setIsCropping] = useState(false);
  const [hoverY, setHoverY] = useState<number | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    isDragging: boolean;
    nodeId: string;
    startClientY: number;
    origY: number;
  }>({ isDragging: false, nodeId: '', startClientY: 0, origY: 0 });

  const genId = () => Math.random().toString(36).substring(2, 11);

  // Convert client Y coordinate to percentage of image height
  const clientYToPercent = useCallback((clientY: number) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return 0;
    const rect = wrapper.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
  }, []);

  // Auto-fit image on load
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (container) {
        const availW = container.clientWidth - 16;
        const fitScale = Math.min(1, availW / img.naturalWidth);
        setScale(Math.max(MIN_SCALE, fitScale));
      }
    });
  }, []);

  // Add node at click position
  const handleWrapperClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-node-handle]')) return;
    const yPct = clientYToPercent(e.clientY);
    setNodes(prev => {
      // Enforce minimum gap with existing nodes
      for (const n of prev) {
        if (Math.abs(n.y - yPct) < MIN_NODE_GAP) return prev;
      }
      return [...prev, { id: genId(), y: yPct }].sort((a, b) => a.y - b.y);
    });
  }, [clientYToPercent]);

  // Start dragging a node
  const handleNodeDragStart = useCallback((nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    dragRef.current = {
      isDragging: true,
      nodeId,
      startClientY: e.clientY,
      origY: node.y,
    };
  }, [nodes]);

  // Window-level drag handlers
  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!dragRef.current.isDragging) return;
      const currentPct = clientYToPercent(e.clientY);
      const dy = currentPct - clientYToPercent(dragRef.current.startClientY);
      let newY = dragRef.current.origY + dy;
      newY = Math.max(MIN_NODE_GAP, Math.min(100 - MIN_NODE_GAP, newY));

      setNodes(prev => {
        // Enforce minimum gap with other nodes
        const others = prev.filter(n => n.id !== dragRef.current.nodeId);
        for (const o of others) {
          if (newY > o.y - MIN_NODE_GAP && newY < o.y + MIN_NODE_GAP) {
            // Too close — snap to the nearest valid position
            newY = newY < o.y ? o.y - MIN_NODE_GAP : o.y + MIN_NODE_GAP;
          }
        }
        newY = Math.max(MIN_NODE_GAP, Math.min(100 - MIN_NODE_GAP, newY));
        const updated = prev.map(n =>
          n.id === dragRef.current.nodeId ? { ...n, y: newY } : n
        ).sort((a, b) => a.y - b.y);
        return updated;
      });
    };

    const handleUp = () => {
      dragRef.current.isDragging = false;
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [clientYToPercent]);

  // Delete a node by id
  const deleteNode = useCallback((nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setNodes(prev => prev.filter(n => n.id !== nodeId));
  }, []);

  // Clear all nodes
  const clearNodes = useCallback(() => setNodes([]), []);

  // Crop at node positions
  const handleCrop = async () => {
    if (naturalSize.width === 0 || naturalSize.height === 0) return;
    setIsCropping(true);
    try {
      const img = await loadElementImage(imageUrl);
      const W = img.naturalWidth;
      const H = img.naturalHeight;

      const boundaries = [0, ...nodes.map(n => n.y), 100];
      const pieces: SlicedPiece[] = [];

      for (let i = 0; i < boundaries.length - 1; i++) {
        const yStart = Math.round((boundaries[i] / 100) * H);
        const yEnd = Math.round((boundaries[i + 1] / 100) * H);
        const srcH = yEnd - yStart;
        if (srcH <= 0) continue;

        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = srcH;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('无法获取 Canvas 上下文');

        ctx.drawImage(img, 0, yStart, W, srcH, 0, 0, W, srcH);

        const url = await new Promise<string>((resolve) => {
          canvas.toBlob((blob) => {
            if (!blob) {
              resolve(canvas.toDataURL('image/png'));
              return;
            }
            resolve(URL.createObjectURL(blob));
          }, 'image/png');
        });

        pieces.push({
          id: `node_${i}_${Date.now()}`,
          url,
          width: W,
          height: srcH,
          index: i,
        });
      }
      onCrop(pieces);
    } catch (err: any) {
      console.error(err);
      alert('裁剪失败: ' + err.message);
    } finally {
      setIsCropping(false);
    }
  };

  // Zoom
  const zoomIn = () => setScale(s => Math.min(MAX_SCALE, +(s + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setScale(s => Math.max(MIN_SCALE, +(s - ZOOM_STEP).toFixed(2)));
  const resetZoom = () => {
    const container = scrollContainerRef.current;
    if (container && naturalSize.width > 0) {
      const availW = container.clientWidth - 16;
      setScale(Math.max(MIN_SCALE, Math.min(1, availW / naturalSize.width)));
    } else {
      setScale(1);
    }
  };

  // Ctrl+Wheel zoom
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        setScale(prev => Math.min(MAX_SCALE, Math.max(MIN_SCALE, +(prev + delta).toFixed(2))));
      }
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // Keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const wrapperW = naturalSize.width > 0 ? naturalSize.width * scale : undefined;
  const wrapperH = naturalSize.height > 0 ? naturalSize.height * scale : undefined;
  const sliceCount = nodes.length + 1;
  const boundaries = [0, ...nodes.map(n => n.y), 100];

  const getSlicePixelHeight = (startPct: number, endPct: number) =>
    Math.round(((endPct - startPct) / 100) * naturalSize.height);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-5xl flex flex-col max-h-[90vh] shadow-2xl border border-gray-800">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold text-white">自定义节点裁剪</h3>
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
              点击图片添加裁剪节点，拖拽节点调整位置
            </span>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Main area */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Image with nodes */}
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-auto bg-gray-950/50 relative"
          >
            <div className="min-w-full min-h-full flex items-start justify-center p-2">
              <div
                ref={wrapperRef}
                className="relative flex-shrink-0"
                style={{
                  width: wrapperW ?? 'auto',
                  height: wrapperH ?? 'auto',
                  cursor: 'crosshair',
                }}
                onClick={handleWrapperClick}
                onMouseMove={(e) => {
                  if (!dragRef.current.isDragging) {
                    setHoverY(clientYToPercent(e.clientY));
                  }
                }}
                onMouseLeave={() => setHoverY(null)}
              >
                <img
                  src={imageUrl}
                  alt="Slice target"
                  className="block w-full h-full select-none"
                  style={{ width: wrapperW, height: wrapperH }}
                  onLoad={handleImageLoad}
                  draggable={false}
                />

                {/* Slice region overlays */}
                {nodes.length > 0 && boundaries.map((start, i) => {
                  if (i >= boundaries.length - 1) return null;
                  const end = boundaries[i + 1];
                  const isEven = i % 2 === 0;
                  return (
                    <div
                      key={`region-${i}`}
                      className={`absolute left-0 right-0 pointer-events-none ${isEven ? 'bg-indigo-500/[0.04]' : 'bg-purple-500/[0.04]'}`}
                      style={{ top: `${start}%`, height: `${end - start}%` }}
                    >
                      <div className="absolute top-1.5 left-2 bg-black/70 text-white text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1.5">
                        <span>#{i + 1}</span>
                        <span className="text-gray-400 font-normal">{getSlicePixelHeight(start, end)}px</span>
                      </div>
                    </div>
                  );
                })}

                {/* Hover guide line */}
                {hoverY !== null && !dragRef.current.isDragging && (
                  <div
                    className="absolute left-0 right-0 h-px bg-white/20 pointer-events-none z-10"
                    style={{ top: `${hoverY}%` }}
                  />
                )}

                {/* Node lines */}
                {nodes.map((node, index) => (
                  <div
                    key={node.id}
                    data-node-handle
                    className="absolute left-0 right-0 z-20"
                    style={{ top: `${node.y}%`, transform: 'translateY(-50%)' }}
                  >
                    {/* Full-width line */}
                    <div
                      className="h-[2px] bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.4)] cursor-ns-resize"
                      onMouseDown={(e) => handleNodeDragStart(node.id, e)}
                    />
                    {/* Handle badge */}
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-1 ml-1 bg-yellow-500 text-gray-900 text-[10px] font-bold pl-1.5 pr-1 py-0.5 rounded-full shadow-lg cursor-ns-resize select-none"
                      onMouseDown={(e) => handleNodeDragStart(node.id, e)}
                    >
                      <GripHorizontal className="w-3 h-3 flex-shrink-0" />
                      <span>{Math.round((node.y / 100) * naturalSize.height)}px</span>
                      <button
                        onClick={(e) => deleteNode(node.id, e)}
                        className="ml-0.5 p-0.5 hover:bg-yellow-600 rounded-full transition-colors"
                        title="删除节点"
                      >
                        <Trash2 className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </div>
                ))}

                {/* Empty state hint */}
                {nodes.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="bg-black/60 backdrop-blur-sm rounded-xl px-6 py-4 text-center">
                      <MousePointerClick className="w-8 h-8 text-yellow-400 mx-auto mb-2" />
                      <p className="text-white text-sm font-medium">点击图片添加裁剪节点</p>
                      <p className="text-gray-400 text-xs mt-1">每条节点线将图片分割为独立切片</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Zoom controls */}
            <div className="sticky bottom-4 right-4 float-right mr-4 mb-4 flex flex-col items-center gap-1 bg-gray-800/90 backdrop-blur rounded-lg p-1 border border-gray-700/50 shadow-lg">
              <button onClick={zoomIn} disabled={scale >= MAX_SCALE} className="p-1.5 text-gray-300 hover:text-white disabled:text-gray-600 transition-colors rounded" title="放大">
                <ZoomIn className="w-4 h-4" />
              </button>
              <span className="text-[10px] text-gray-400 font-mono tabular-nums min-w-[36px] text-center">{Math.round(scale * 100)}%</span>
              <button onClick={zoomOut} disabled={scale <= MIN_SCALE} className="p-1.5 text-gray-300 hover:text-white disabled:text-gray-600 transition-colors rounded" title="缩小">
                <ZoomOut className="w-4 h-4" />
              </button>
              <button onClick={resetZoom} className="w-full text-[10px] px-1.5 py-0.5 rounded font-medium text-gray-400 hover:text-white hover:bg-gray-700/50 transition-colors">
                适应
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-800 bg-gray-900 rounded-b-2xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400">
              {nodes.length > 0
                ? `${nodes.length} 个节点 · ${sliceCount} 张切片`
                : '点击图片添加裁剪节点'}
            </span>
            {nodes.length > 0 && (
              <button
                onClick={clearNodes}
                className="text-xs text-gray-500 hover:text-red-400 transition-colors"
              >
                清空节点
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-xl font-medium text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
              disabled={isCropping}
            >
              取消
            </button>
            <button
              onClick={handleCrop}
              disabled={isCropping}
              className="px-5 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl font-medium flex items-center gap-2 transform hover:scale-[1.02] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCropping ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              确认裁剪 ({sliceCount} 张)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
