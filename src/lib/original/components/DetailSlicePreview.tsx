import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Download, Eye, Package, X, Edit3, Maximize2 } from 'lucide-react';
import { SlicedPiece } from '../types';
// JSZip lazy-loaded on demand to reduce page load memory pressure

interface DetailSlicePreviewProps {
  sourceFileName: string;
  pieces: SlicedPiece[];
  isSlicing: boolean;
  progressCurrent?: number;
  progressTotal?: number;
  onRemove: () => void;
  cropNodes?: number[];
  sourceImageUrl?: string;
  onReEdit?: () => void;
  onPreviewWithNodes?: () => void;
}

export const DetailSlicePreview: React.FC<DetailSlicePreviewProps> = ({
  sourceFileName,
  pieces,
  isSlicing,
  progressCurrent,
  progressTotal,
  onRemove,
  cropNodes,
  sourceImageUrl,
  onReEdit,
  onPreviewWithNodes,
}) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isZipping, setIsZipping] = useState(false);
  const [showNodePreview, setShowNodePreview] = useState(false);
  const [previewNaturalSize, setPreviewNaturalSize] = useState({ width: 0, height: 0 });
  const nodePreviewImgRef = useRef<HTMLImageElement>(null);

  const downloadSingle = useCallback((piece: SlicedPiece) => {
    const link = document.createElement('a');
    link.href = piece.url;
    const baseName = sourceFileName.replace(/\.[^.]+$/, '');
    link.download = `${baseName}_slice_${piece.index + 1}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [sourceFileName]);

  const handleBatchDownload = useCallback(async () => {
    if (pieces.length === 0) return;

    if (pieces.length === 1) {
      downloadSingle(pieces[0]);
      return;
    }

    setIsZipping(true);
    try {
      const baseName = sourceFileName.replace(/\.[^.]+$/, '');

      // Fetch all blobs first to estimate total size
      const blobs: { name: string; blob: Blob }[] = [];
      await Promise.all(
        pieces.map(async (piece) => {
          const response = await fetch(piece.url);
          const blob = await response.blob();
          blobs.push({ name: `${baseName}_slice_${piece.index + 1}.png`, blob });
        })
      );

      const totalSize = blobs.reduce((sum, b) => sum + b.blob.size, 0);
      // If total exceeds 800MB, download individually instead of zipping
      if (totalSize > 800 * 1024 * 1024) {
        for (const b of blobs) {
          const url = URL.createObjectURL(b.blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = b.name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          await new Promise(r => setTimeout(r, 100));
        }
        return;
      }

      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const b of blobs) zip.file(b.name, b.blob);
      const content = await zip.generateAsync({ type: 'blob', streamFiles: true });
      const link = document.createElement('a');
      const contentUrl = URL.createObjectURL(content);
      link.href = contentUrl;
      link.download = `${baseName}_slices_${new Date().getTime()}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(contentUrl);
    } catch (err) {
      console.error('批量下载失败', err);
    } finally {
      setIsZipping(false);
    }
  }, [pieces, sourceFileName, downloadSingle]);

  return (
    <div className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700">
      {/* Header */}
      <div className="px-4 py-3 bg-gray-800 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-indigo-400 truncate">
            {sourceFileName}
          </span>
          <span className="text-xs text-gray-500 flex-shrink-0">
            {isSlicing ? '切片中...' : `${pieces.length} 张切片`}
          </span>
          {cropNodes && cropNodes.length > 0 && (
            <span className="text-[10px] text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded">
              自定义节点
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {cropNodes && cropNodes.length > 0 && sourceImageUrl && !isSlicing && (
            <>
              <button
                onClick={() => setShowNodePreview(true)}
                className="px-3 py-1.5 text-xs bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-400 border border-yellow-600/30 rounded-lg transition-colors flex items-center gap-1.5"
                title="预览原图及裁剪节点"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                查看节点
              </button>
              {onReEdit && (
                <button
                  onClick={onReEdit}
                  className="px-3 py-1.5 text-xs bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 border border-indigo-600/30 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  重新编辑
                </button>
              )}
            </>
          )}
          {!isSlicing && pieces.length > 0 && (
            <button
              onClick={handleBatchDownload}
              disabled={isZipping}
              className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white rounded-lg transition-colors flex items-center gap-1.5"
            >
              {isZipping ? (
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Package className="w-3.5 h-3.5" />
              )}
              批量下载
            </button>
          )}
          <button
            onClick={onRemove}
            className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Progress */}
      {isSlicing && (
        <div className="px-4 py-3 bg-gray-900/50">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-2">
            <span>正在切片...</span>
            <span>{progressCurrent}/{progressTotal}</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
            <div
              className="bg-indigo-500 h-full transition-all duration-300 ease-out"
              style={{ width: `${progressTotal ? ((progressCurrent || 0) / progressTotal) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Slice Grid */}
      {!isSlicing && pieces.length > 0 && (
        <div className="p-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {pieces.map((piece) => (
            <div
              key={piece.id}
              className="group relative bg-gray-900 rounded-lg overflow-hidden border border-gray-700 hover:border-indigo-500/50 transition-all"
            >
              <div className="relative flex items-center justify-center bg-gray-950" style={{ aspectRatio: `${piece.width}/${piece.height}` }}>
                <img
                  src={piece.url}
                  alt={`切片 ${piece.index + 1}`}
                  className="w-full h-full object-contain"
                />
                <div className="absolute top-1.5 left-1.5 bg-black/70 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                  #{piece.index + 1}
                </div>
              </div>
              <div className="px-2 py-1.5 bg-gray-800 border-t border-gray-700 flex items-center justify-between">
                <span className="text-[10px] text-gray-500">
                  {piece.width}×{piece.height}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPreviewUrl(piece.url)}
                    className="p-1 hover:bg-indigo-500/20 text-indigo-400 rounded transition-colors"
                    title="预览"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => downloadSingle(piece)}
                    className="p-1 hover:bg-green-500/20 text-green-400 rounded transition-colors"
                    title="下载"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full-size Preview Modal */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewUrl(null)}
        >
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <img
              src={previewUrl}
              alt="预览"
              className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={() => setPreviewUrl(null)}
              className="absolute -top-3 -right-3 p-2 bg-gray-800 hover:bg-gray-700 text-white rounded-full shadow-lg border border-gray-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Node Preview Modal - shows original image with crop point markers */}
      {showNodePreview && sourceImageUrl && (
        <div
          className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowNodePreview(false)}
        >
          <div className="relative max-w-[80vw] max-h-[90vh] flex flex-col items-center" onClick={(e) => e.stopPropagation()}>
            <div className="relative inline-flex items-center justify-center">
              <img
                ref={nodePreviewImgRef}
                src={sourceImageUrl}
                alt="裁剪节点预览"
                className="max-w-[80vw] max-h-[78vh] object-contain rounded-lg shadow-2xl"
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setPreviewNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
                }}
              />
              {/* Crop node markers overlay - positioned over the actual rendered image area */}
              {previewNaturalSize.width > 0 && cropNodes && (() => {
                const img = nodePreviewImgRef.current;
                if (!img) return null;
                // Calculate the actual rendered image rect (object-contain may leave gaps)
                const containerW = img.clientWidth;
                const containerH = img.clientHeight;
                const imgRatio = previewNaturalSize.width / previewNaturalSize.height;
                const containerRatio = containerW / containerH;
                let renderW: number, renderH: number, offsetX: number, offsetY: number;
                if (imgRatio > containerRatio) {
                  renderW = containerW;
                  renderH = containerW / imgRatio;
                  offsetX = 0;
                  offsetY = (containerH - renderH) / 2;
                } else {
                  renderH = containerH;
                  renderW = containerH * imgRatio;
                  offsetX = (containerW - renderW) / 2;
                  offsetY = 0;
                }
                const boundaries = [0, ...cropNodes, 100];
                return (
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      left: offsetX,
                      top: offsetY,
                      width: renderW,
                      height: renderH,
                    }}
                  >
                    {boundaries.slice(0, -1).map((start, idx) => {
                      const end = boundaries[idx + 1];
                      const isEven = idx % 2 === 0;
                      const isLastRegion = idx === boundaries.length - 2;
                      return (
                        <React.Fragment key={`preview-node-${idx}`}>
                          <div
                            className={`absolute left-0 right-0 ${isEven ? 'bg-indigo-500/10' : 'bg-purple-500/10'}`}
                            style={{ top: `${start}%`, height: `${end - start}%` }}
                          >
                            <div className="absolute top-1 left-2 bg-black/70 text-white text-[11px] font-bold px-2 py-0.5 rounded">
                              #{idx + 1}
                            </div>
                          </div>
                          {!isLastRegion && cropNodes[idx] !== undefined && (
                            <div
                              className="absolute left-0 right-0"
                              style={{ top: `${cropNodes[idx]}%`, transform: 'translateY(-50%)' }}
                            >
                              <div className="h-[2px] bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.6)]" />
                              <div className="absolute left-2 top-1/2 -translate-y-1/2 bg-yellow-500 text-gray-900 text-[10px] font-bold px-2 py-0.5 rounded-full shadow-lg">
                                节点 {idx + 1}
                              </div>
                            </div>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span className="text-sm text-gray-400">
                {cropNodes?.length ?? 0} 个裁剪节点 · {(cropNodes?.length ?? 0) + 1} 张切片
              </span>
              <button
                onClick={() => setShowNodePreview(false)}
                className="px-4 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
