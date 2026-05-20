import React, { useState, useRef, useCallback, useEffect } from 'react';
import ReactCrop, { Crop, PixelCrop, centerCrop, makeAspectCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { X, Check, ZoomIn, ZoomOut } from 'lucide-react';
import { getCroppedImg } from '../services/cropService';

interface CropModalProps {
  imageUrl: string;
  onClose: () => void;
  onSave: (croppedFile: File) => void;
  defaultAspect?: number | null;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 5;
const ZOOM_STEP = 0.15;

export function CropModal({ imageUrl, onClose, onSave, defaultAspect = undefined }: CropModalProps) {
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [aspect, setAspect] = useState<number | undefined>(defaultAspect === null ? undefined : defaultAspect);
  const imgRef = useRef<HTMLImageElement>(null);
  const [isCropping, setIsCropping] = useState(false);

  // Zoom & Pan state
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const translateStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Reset zoom & pan when image changes
  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const { width, height } = e.currentTarget;
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    const resolvedAspect = defaultAspect === null ? undefined : defaultAspect;

    if (resolvedAspect) {
        const initialCrop = centerCrop(
          makeAspectCrop({ unit: '%', width: 90 }, resolvedAspect, width, height),
          width,
          height
        );
        setCrop(initialCrop);
    } else {
        const imgAspect = width / height;
        const initialCrop = centerCrop(
            makeAspectCrop({ unit: '%', width: 90 }, imgAspect, width, height),
            width,
            height
        );
        setCrop(initialCrop);
    }
  }

  // Zoom buttons
  const zoomIn = () => setScale(s => Math.min(MAX_SCALE, +(s + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setScale(s => Math.max(MIN_SCALE, +(s - ZOOM_STEP).toFixed(2)));

  // Pan handlers (drag to pan when zoomed in)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (scale <= 1) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX, y: e.clientY };
    translateStart.current = { ...translate };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [scale, translate]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setTranslate({
      x: translateStart.current.x + dx,
      y: translateStart.current.y + dy,
    });
  }, []);

  const handlePointerUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  // Wheel zoom via native non-passive listener (React 19 onWheel is passive — can't preventDefault)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      setScale(prev => {
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev + delta));
        if (next === prev) return prev;
        const ratio = next / prev;
        setTranslate(t => ({
          x: cx - ratio * (cx - t.x),
          y: cy - ratio * (cy - t.y),
        }));
        return next;
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const handleApplyCrop = async () => {
    if (!completedCrop || !imgRef.current) return;
    setIsCropping(true);
    try {
      // Use getBoundingClientRect() which accounts for CSS transforms (scale/translate).
      // react-image-crop computes completedCrop pixel values using getBoundingClientRect()
      // internally, so the scale factor must use the same (visual) reference dimensions.
      const rect = imgRef.current.getBoundingClientRect();
      const scaleX = imgRef.current.naturalWidth / rect.width;
      const scaleY = imgRef.current.naturalHeight / rect.height;

      const actualCrop = {
          x: completedCrop.x * scaleX,
          y: completedCrop.y * scaleY,
          width: completedCrop.width * scaleX,
          height: completedCrop.height * scaleY,
      };

      const file = await getCroppedImg(imageUrl, actualCrop);
      onSave(file);
    } catch (err) {
      console.error(err);
      alert('裁剪失败');
    } finally {
      setIsCropping(false);
    }
  };

  const aspectRatios = [
    { label: '自定义', value: undefined },
    { label: '1:1', value: 1 },
    { label: '3:4', value: 3 / 4 },
  ];

  const handleAspectChange = (value: number | undefined) => {
    setAspect(value);
    if (value && imgRef.current) {
        const { width, height } = imgRef.current;
        const newCrop = centerCrop(
            makeAspectCrop({ unit: '%', width: 90 }, value, width, height),
            width,
            height
        );
        setCrop(newCrop);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-gray-900 rounded-2xl w-full max-w-4xl flex flex-col max-h-[90vh] shadow-2xl border border-gray-800">
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h3 className="text-xl font-bold text-white">图片裁剪</h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div
          ref={containerRef}
          className="flex-1 overflow-hidden p-4 flex items-center justify-center bg-gray-950/50 relative select-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{ cursor: scale > 1 ? (isPanning.current ? 'grabbing' : 'grab') : 'default' }}
        >
          <div
            style={{
              transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
              transformOrigin: 'center center',
              transition: isPanning.current ? 'none' : 'transform 0.15s ease-out',
            }}
          >
            <ReactCrop
              crop={crop}
              onChange={(_, percentCrop) => setCrop(percentCrop)}
              onComplete={(c) => setCompletedCrop(c)}
              aspect={aspect}
            >
              <img
                ref={imgRef}
                src={imageUrl}
                alt="Crop target"
                className="max-w-full max-h-full object-contain rounded-lg"
                onLoad={onImageLoad}
                draggable={false}
              />
            </ReactCrop>
          </div>

          {/* Zoom controls */}
          <div className="absolute bottom-6 right-6 flex flex-col items-center gap-1 bg-gray-800/80 backdrop-blur rounded-lg p-1 border border-gray-700/50">
            <button onClick={zoomIn} disabled={scale >= MAX_SCALE} className="p-1.5 text-gray-300 hover:text-white disabled:text-gray-600 transition-colors rounded" title="放大">
              <ZoomIn className="w-4 h-4" />
            </button>
            <span className="text-[10px] text-gray-400 font-mono tabular-nums min-w-[36px] text-center">{Math.round(scale * 100)}%</span>
            <button onClick={zoomOut} disabled={scale <= MIN_SCALE} className="p-1.5 text-gray-300 hover:text-white disabled:text-gray-600 transition-colors rounded" title="缩小">
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={() => setScale(0.5)}
              className={`w-full text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors ${
                Math.abs(scale - 0.5) < 0.01
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              50%
            </button>
            <button
              onClick={() => { setScale(1); setTranslate({ x: 0, y: 0 }); }}
              className={`w-full text-[10px] px-1.5 py-0.5 rounded font-medium transition-colors ${
                Math.abs(scale - 1) < 0.01
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
              }`}
            >
              100%
            </button>
          </div>

        </div>

        <div className="p-4 border-t border-gray-800 bg-gray-900 rounded-b-2xl flex items-center justify-between">
          <div className="flex gap-2">
            {aspectRatios.map((ratio) => (
              <button
                key={ratio.label}
                onClick={() => handleAspectChange(ratio.value)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  aspect === ratio.value
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {ratio.label}
              </button>
            ))}
          </div>

          <div className="flex gap-3">
            <button 
                onClick={onClose}
                className="px-6 py-2 rounded-xl font-medium text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
                disabled={isCropping}
            >
                取消
            </button>
            <button 
                onClick={handleApplyCrop}
                disabled={!completedCrop || isCropping}
                className="px-6 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white rounded-xl font-medium flex items-center gap-2 transform hover:scale-[1.02] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
                {isCropping ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                    <Check className="w-4 h-4" />
                )}
                确认裁剪
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
