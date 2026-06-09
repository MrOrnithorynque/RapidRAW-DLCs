import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, Loader2, Save } from 'lucide-react';
import { Invokes } from '../ui/AppProperties';
import Button from '../ui/Button';
import Slider from '../ui/Slider';
import Switch from '../ui/Switch';
import Dropdown from '../ui/Dropdown';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';

interface ImageTrackModalProps {
  isOpen: boolean;
  onClose(): void;
  onSave(base64Data: string, firstPath: string): Promise<string>;
  sourcePath: string | null;
}

interface Blob {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  area: number;
}

enum RegionStyle {
  Box = 'box',
  Frame = 'frame',
  Crosshair = 'crosshair',
  Dashed = 'dashed',
  Scope = 'scope',
  Grid = 'grid',
}

enum ConnectionStyle {
  Hub = 'hub',
  Chain = 'chain',
}

enum LabelType {
  Index = 'index',
  Id = 'id',
}

enum TextPosition {
  Top = 'top',
  Center = 'center',
  Bottom = 'bottom',
}

const DETECT_MAX_DIM = 700;

function blobColor(index: number, base: string, perBlob: boolean, crazy: boolean): string {
  if (crazy) {
    const hue = (index * 137 + ((index * index) % 90)) % 360;
    const sat = 70 + ((index * 31) % 30);
    const lum = 45 + ((index * 53) % 35);
    return `hsl(${hue}, ${sat}%, ${lum}%)`;
  }
  if (!perBlob) {
    return base;
  }
  const hue = (index * 47) % 360;
  return `hsl(${hue}, 85%, 60%)`;
}

function detectBlobs(
  img: HTMLImageElement,
  threshold: number,
  detectDark: boolean,
  minSizePct: number,
  maxBlobs: number,
): Blob[] {
  const scale = Math.min(1, DETECT_MAX_DIM / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return [];
  }
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const on = detectDark ? luma < threshold : luma > threshold;
    mask[i] = on ? 1 : 0;
  }

  const visited = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const blobs: Blob[] = [];
  const minDim = (minSizePct / 100) * Math.min(w, h);
  const invScale = 1 / scale;

  for (let start = 0; start < w * h; start++) {
    if (mask[start] === 0 || visited[start] === 1) {
      continue;
    }
    let sp = 0;
    stack[sp++] = start;
    visited[start] = 1;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let sumX = 0;
    let sumY = 0;
    let count = 0;

    while (sp > 0) {
      const p = stack[--sp];
      const px = p % w;
      const py = (p - px) / w;
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
      sumX += px;
      sumY += py;
      count++;

      const neighbors = [p - 1, p + 1, p - w, p + w];
      for (let n = 0; n < 4; n++) {
        const np = neighbors[n];
        if (np < 0 || np >= w * h) continue;
        // Prevent horizontal wrap.
        if (n === 0 && px === 0) continue;
        if (n === 1 && px === w - 1) continue;
        if (mask[np] === 1 && visited[np] === 0) {
          visited[np] = 1;
          stack[sp++] = np;
        }
      }
    }

    const bw = maxX - minX;
    const bh = maxY - minY;
    if (Math.max(bw, bh) < minDim) {
      continue;
    }

    blobs.push({
      minX: minX * invScale,
      minY: minY * invScale,
      maxX: maxX * invScale,
      maxY: maxY * invScale,
      cx: (sumX / count) * invScale,
      cy: (sumY / count) * invScale,
      area: count,
    });
  }

  blobs.sort((a, b) => b.area - a.area);
  return blobs.slice(0, maxBlobs);
}

export default function ImageTrackModal({ isOpen, onClose, onSave, sourcePath }: ImageTrackModalProps) {
  const { t } = useTranslation();

  const [isMounted, setIsMounted] = useState(false);
  const [show, setShow] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [imageReady, setImageReady] = useState(false);

  const [threshold, setThreshold] = useState(120);
  const [detectDark, setDetectDark] = useState(false);
  const [minSize, setMinSize] = useState(4);
  const [blobCount, setBlobCount] = useState(24);
  const [regionStyle, setRegionStyle] = useState<RegionStyle>(RegionStyle.Box);
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [showLabels, setShowLabels] = useState(true);
  const [labelType, setLabelType] = useState<LabelType>(LabelType.Index);
  const [showConnections, setShowConnections] = useState(false);
  const [connectionStyle, setConnectionStyle] = useState<ConnectionStyle>(ConnectionStyle.Hub);
  const [dashedConnections, setDashedConnections] = useState(true);
  const [connectionRate, setConnectionRate] = useState(100);
  const [dashSize, setDashSize] = useState(5);
  const [gapSize, setGapSize] = useState(5);
  const [color, setColor] = useState('#34d399');
  const [perBlobColor, setPerBlobColor] = useState(false);
  const [crazyColors, setCrazyColors] = useState(false);
  const [uniformSize, setUniformSize] = useState(0);
  const [textPosition, setTextPosition] = useState<TextPosition>(TextPosition.Top);

  const [manualMode, setManualMode] = useState(false);
  const [manualBoxes, setManualBoxes] = useState<Blob[]>([]);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);

  const imageElRef = useRef<HTMLImageElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (isOpen) {
      setIsMounted(true);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    }
    setShow(false);
    const timer = setTimeout(() => {
      setIsMounted(false);
      setIsLoading(true);
      setIsSaving(false);
      setError(null);
      setSavedPath(null);
      setImageReady(false);
      imageElRef.current = null;
      setManualBoxes([]);
      setManualMode(false);
      setDrawStart(null);
      setDrawCurrent(null);
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !sourcePath) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const metadata: any = await invoke(Invokes.LoadMetadata, { path: sourcePath });
        const adjustments = metadata.adjustments && !metadata.adjustments.is_null ? metadata.adjustments : {};
        const imageData: Uint8Array = await invoke(Invokes.GeneratePreviewForPath, {
          path: sourcePath,
          jsAdjustments: adjustments,
        });
        if (cancelled) {
          return;
        }
        const blob = new Blob([imageData], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        const img = new Image();
        img.onload = () => {
          if (cancelled) {
            return;
          }
          imageElRef.current = img;
          setImageReady(true);
          setIsLoading(false);
        };
        img.onerror = () => {
          if (!cancelled) {
            setError(t('modals.imageTrack.loadError'));
            setIsLoading(false);
          }
        };
        img.src = url;
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || t('modals.imageTrack.loadError'));
          setIsLoading(false);
        }
      }
    };
    const timer = setTimeout(load, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, sourcePath, t]);

  const detectedBlobs = useMemo(() => {
    if (manualMode || !imageReady || !imageElRef.current) {
      return [];
    }
    return detectBlobs(imageElRef.current, threshold, detectDark, minSize, blobCount);
  }, [manualMode, imageReady, threshold, detectDark, minSize, blobCount]);

  // The regions actually drawn: manual boxes in manual mode, else auto-detected.
  // `uniformSize` (when > 0) forces every box to a fixed square around its center.
  const blobs = useMemo(() => {
    const src = manualMode ? manualBoxes : detectedBlobs;
    if (uniformSize <= 0) {
      return src;
    }
    const half = uniformSize / 2;
    return src.map((b) => ({
      ...b,
      minX: b.cx - half,
      minY: b.cy - half,
      maxX: b.cx + half,
      maxY: b.cy + half,
    }));
  }, [manualMode, manualBoxes, detectedBlobs, uniformSize]);

  const drawScene = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const img = imageElRef.current;
      if (!img) {
        return;
      }
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      const ref = Math.max(w, h);
      const lw = Math.max(1, (strokeWidth / 1000) * ref);
      const font = Math.max(9, (ref / 1000) * 14);
      ctx.lineWidth = lw;
      ctx.font = `${font}px monospace`;
      ctx.textBaseline = 'top';

      if (showConnections && blobs.length > 1) {
        // Connection Rate limits how many regions get linked (fraction of the set).
        const connectCount = Math.max(2, Math.round((connectionRate / 100) * blobs.length));
        const connected = blobs.slice(0, connectCount);
        const dashScale = ref / 1000;
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, lw * 0.6);
        ctx.setLineDash(dashedConnections ? [dashSize * dashScale, gapSize * dashScale] : []);
        ctx.beginPath();
        if (connectionStyle === ConnectionStyle.Hub) {
          const hubX = w / 2;
          const hubY = h / 2;
          connected.forEach((b) => {
            ctx.moveTo(hubX, hubY);
            ctx.lineTo(b.cx, b.cy);
          });
        } else {
          connected.forEach((b, i) => {
            if (i === 0) {
              ctx.moveTo(b.cx, b.cy);
            } else {
              ctx.lineTo(b.cx, b.cy);
            }
          });
        }
        ctx.stroke();
        ctx.restore();
      }

      blobs.forEach((b, i) => {
        const c = blobColor(i, color, perBlobColor, crazyColors);
        ctx.strokeStyle = c;
        ctx.fillStyle = c;
        ctx.lineWidth = lw;
        ctx.setLineDash([]);
        const x = b.minX;
        const y = b.minY;
        const bw = b.maxX - b.minX;
        const bh = b.maxY - b.minY;
        const cx = b.cx;
        const cy = b.cy;

        switch (regionStyle) {
          case RegionStyle.Box:
            ctx.strokeRect(x, y, bw, bh);
            break;
          case RegionStyle.Dashed:
            ctx.setLineDash([font * 0.5, font * 0.4]);
            ctx.strokeRect(x, y, bw, bh);
            ctx.setLineDash([]);
            break;
          case RegionStyle.Frame: {
            const len = Math.min(bw, bh) * 0.28 + lw;
            ctx.beginPath();
            ctx.moveTo(x, y + len);
            ctx.lineTo(x, y);
            ctx.lineTo(x + len, y);
            ctx.moveTo(x + bw - len, y);
            ctx.lineTo(x + bw, y);
            ctx.lineTo(x + bw, y + len);
            ctx.moveTo(x + bw, y + bh - len);
            ctx.lineTo(x + bw, y + bh);
            ctx.lineTo(x + bw - len, y + bh);
            ctx.moveTo(x + len, y + bh);
            ctx.lineTo(x, y + bh);
            ctx.lineTo(x, y + bh - len);
            ctx.stroke();
            break;
          }
          case RegionStyle.Crosshair: {
            const r = Math.max(bw, bh) * 0.5;
            const gap = r * 0.3;
            ctx.beginPath();
            ctx.moveTo(cx - r, cy);
            ctx.lineTo(cx - gap, cy);
            ctx.moveTo(cx + gap, cy);
            ctx.lineTo(cx + r, cy);
            ctx.moveTo(cx, cy - r);
            ctx.lineTo(cx, cy - gap);
            ctx.moveTo(cx, cy + gap);
            ctx.lineTo(cx, cy + r);
            ctx.stroke();
            break;
          }
          case RegionStyle.Scope: {
            const r = Math.max(bw, bh) * 0.55;
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, Math.PI * 2);
            ctx.stroke();
            const tick = r * 0.25;
            ctx.beginPath();
            ctx.moveTo(cx - r, cy);
            ctx.lineTo(cx - r + tick, cy);
            ctx.moveTo(cx + r - tick, cy);
            ctx.lineTo(cx + r, cy);
            ctx.moveTo(cx, cy - r);
            ctx.lineTo(cx, cy - r + tick);
            ctx.moveTo(cx, cy + r - tick);
            ctx.lineTo(cx, cy + r);
            ctx.stroke();
            break;
          }
          case RegionStyle.Grid: {
            ctx.strokeRect(x, y, bw, bh);
            ctx.beginPath();
            ctx.moveTo(x + bw / 3, y);
            ctx.lineTo(x + bw / 3, y + bh);
            ctx.moveTo(x + (2 * bw) / 3, y);
            ctx.lineTo(x + (2 * bw) / 3, y + bh);
            ctx.moveTo(x, y + bh / 3);
            ctx.lineTo(x + bw, y + bh / 3);
            ctx.moveTo(x, y + (2 * bh) / 3);
            ctx.lineTo(x + bw, y + (2 * bh) / 3);
            ctx.stroke();
            break;
          }
          default:
            ctx.strokeRect(x, y, bw, bh);
        }

        if (showLabels) {
          const label =
            labelType === LabelType.Index
              ? String(i + 1).padStart(2, '0')
              : `0x${((b.area * 2654435761) >>> 0).toString(16).slice(0, 4).toUpperCase()}`;
          const padX = font * 0.3;
          const padY = font * 0.2;
          const tw = ctx.measureText(label).width;
          let ly: number;
          if (textPosition === TextPosition.Center) {
            ly = cy - font / 2 - padY;
          } else if (textPosition === TextPosition.Bottom) {
            ly = y + bh + padY;
          } else {
            ly = y - font - padY * 2;
          }
          ctx.fillStyle = c;
          ctx.fillRect(x, ly, tw + padX * 2, font + padY * 2);
          ctx.fillStyle = '#000000';
          ctx.fillText(label, x + padX, ly + padY);
        }
      });

      // Live preview of the box currently being dragged in manual mode.
      if (manualMode && drawStart && drawCurrent) {
        const dx = Math.min(drawStart.x, drawCurrent.x);
        const dy = Math.min(drawStart.y, drawCurrent.y);
        const dw = Math.abs(drawCurrent.x - drawStart.x);
        const dh = Math.abs(drawCurrent.y - drawStart.y);
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.setLineDash([font * 0.4, font * 0.3]);
        ctx.strokeRect(dx, dy, dw, dh);
        ctx.restore();
      }
    },
    [
      blobs,
      regionStyle,
      strokeWidth,
      showLabels,
      labelType,
      textPosition,
      showConnections,
      connectionStyle,
      dashedConnections,
      connectionRate,
      dashSize,
      gapSize,
      color,
      perBlobColor,
      crazyColors,
      manualMode,
      drawStart,
      drawCurrent,
    ],
  );

  useEffect(() => {
    if (!imageReady || !canvasRef.current) {
      return;
    }
    const img = imageElRef.current;
    if (!img) {
      return;
    }
    const canvas = canvasRef.current;
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      drawScene(ctx, img.width, img.height);
    }
  }, [imageReady, drawScene]);

  const handleSave = useCallback(async () => {
    const img = imageElRef.current;
    if (!img || !sourcePath) {
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const out = document.createElement('canvas');
      out.width = img.width;
      out.height = img.height;
      const ctx = out.getContext('2d');
      if (!ctx) {
        throw new Error(t('modals.imageTrack.errorTitle'));
      }
      drawScene(ctx, img.width, img.height);
      const dataUrl = out.toDataURL('image/png');
      const saved = await onSave(dataUrl, sourcePath);
      setSavedPath(saved);
    } catch (err: any) {
      setError(err?.message || t('modals.imageTrack.errorTitle'));
    } finally {
      setIsSaving(false);
    }
  }, [drawScene, onSave, sourcePath, t]);

  // Map a mouse event on the displayed canvas to full-resolution image coords.
  const eventToImage = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }, []);

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!manualMode) {
        return;
      }
      const p = eventToImage(e);
      if (!p) {
        return;
      }
      // Click inside an existing box removes it; otherwise begin drawing a new one.
      const hitIndex = manualBoxes.findIndex((b) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY);
      if (hitIndex !== -1) {
        setManualBoxes((prev) => prev.filter((_, i) => i !== hitIndex));
        return;
      }
      setDrawStart(p);
      setDrawCurrent(p);
    },
    [manualMode, eventToImage, manualBoxes],
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!manualMode || !drawStart) {
        return;
      }
      const p = eventToImage(e);
      if (p) {
        setDrawCurrent(p);
      }
    },
    [manualMode, drawStart, eventToImage],
  );

  const finishDraw = useCallback(() => {
    if (manualMode && drawStart && drawCurrent) {
      const minX = Math.min(drawStart.x, drawCurrent.x);
      const minY = Math.min(drawStart.y, drawCurrent.y);
      const maxX = Math.max(drawStart.x, drawCurrent.x);
      const maxY = Math.max(drawStart.y, drawCurrent.y);
      if (maxX - minX > 4 && maxY - minY > 4) {
        setManualBoxes((prev) => [
          ...prev,
          { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, area: (maxX - minX) * (maxY - minY) },
        ]);
      }
    }
    setDrawStart(null);
    setDrawCurrent(null);
  }, [manualMode, drawStart, drawCurrent]);

  const styleOptions = useMemo(
    () => [
      { label: t('modals.imageTrack.styleBox'), value: RegionStyle.Box },
      { label: t('modals.imageTrack.styleFrame'), value: RegionStyle.Frame },
      { label: t('modals.imageTrack.styleCrosshair'), value: RegionStyle.Crosshair },
      { label: t('modals.imageTrack.styleDashed'), value: RegionStyle.Dashed },
      { label: t('modals.imageTrack.styleScope'), value: RegionStyle.Scope },
      { label: t('modals.imageTrack.styleGrid'), value: RegionStyle.Grid },
    ],
    [t],
  );

  const labelOptions = useMemo(
    () => [
      { label: t('modals.imageTrack.labelIndex'), value: LabelType.Index },
      { label: t('modals.imageTrack.labelId'), value: LabelType.Id },
    ],
    [t],
  );

  const connectionOptions = useMemo(
    () => [
      { label: t('modals.imageTrack.connHub'), value: ConnectionStyle.Hub },
      { label: t('modals.imageTrack.connChain'), value: ConnectionStyle.Chain },
    ],
    [t],
  );

  const textPositionOptions = useMemo(
    () => [
      { label: t('modals.imageTrack.posTop'), value: TextPosition.Top },
      { label: t('modals.imageTrack.posCenter'), value: TextPosition.Center },
      { label: t('modals.imageTrack.posBottom'), value: TextPosition.Bottom },
    ],
    [t],
  );

  const renderControls = () => (
    <div className="w-80 shrink-0 h-full overflow-y-auto bg-surface p-4 space-y-4">
      <div>
        <Text variant={TextVariants.heading} className="mb-1">
          {t('modals.imageTrack.title')}
        </Text>
        <Text variant={TextVariants.small} className="text-text-secondary">
          {t('modals.imageTrack.detected', { count: blobs.length })}
        </Text>
      </div>

      <div className="p-2 bg-bg-tertiary rounded-md">
        <Switch
          label={t('modals.imageTrack.manualMode')}
          checked={manualMode}
          onChange={(v: boolean) => {
            setManualMode(v);
            setDrawStart(null);
            setDrawCurrent(null);
          }}
        />
        {manualMode && (
          <>
            <Text variant={TextVariants.small} className="text-text-secondary mt-2 block">
              {t('modals.imageTrack.manualHint')}
            </Text>
            <Button
              onClick={() => setManualBoxes([])}
              disabled={manualBoxes.length === 0}
              className="w-full justify-center mt-2"
            >
              {t('modals.imageTrack.clearRegions')}
            </Button>
          </>
        )}
      </div>

      {!manualMode && (
        <div className="p-2 bg-bg-tertiary rounded-md">
          <Text variant={TextVariants.heading} className="mb-2">
            {t('modals.imageTrack.detection')}
          </Text>
          <Slider
            label={t('modals.imageTrack.threshold')}
            min={0}
            max={255}
            step={1}
            value={threshold}
            onChange={(e: any) => setThreshold(parseInt(e.target.value, 10))}
          />
          <Slider
            label={t('modals.imageTrack.minSize')}
            min={1}
            max={40}
            step={1}
            value={minSize}
            onChange={(e: any) => setMinSize(parseInt(e.target.value, 10))}
          />
          <Slider
            label={t('modals.imageTrack.maxRegions')}
            min={1}
            max={100}
            step={1}
            value={blobCount}
            onChange={(e: any) => setBlobCount(parseInt(e.target.value, 10))}
          />
          <div className="mt-2">
            <Switch label={t('modals.imageTrack.detectDark')} checked={detectDark} onChange={setDetectDark} />
          </div>
        </div>
      )}

      <div className="p-2 bg-bg-tertiary rounded-md">
        <Text variant={TextVariants.heading} className="mb-2">
          {t('modals.imageTrack.appearance')}
        </Text>
        <div className="mb-2">
          <Text variant={TextVariants.small} className="mb-1">
            {t('modals.imageTrack.regionStyle')}
          </Text>
          <Dropdown options={styleOptions} value={regionStyle} onChange={(v: RegionStyle) => setRegionStyle(v)} />
        </div>
        <Slider
          label={t('modals.imageTrack.strokeWidth')}
          min={1}
          max={10}
          step={1}
          value={strokeWidth}
          onChange={(e: any) => setStrokeWidth(parseInt(e.target.value, 10))}
        />
        <Slider
          label={t('modals.imageTrack.uniformSize')}
          min={0}
          max={512}
          step={1}
          value={uniformSize}
          onChange={(e: any) => setUniformSize(parseInt(e.target.value, 10))}
        />
        <div className="flex items-center justify-between mt-2">
          <Text variant={TextVariants.small}>{t('modals.imageTrack.color')}</Text>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="w-8 h-8 rounded cursor-pointer bg-transparent border border-surface"
          />
        </div>
        <div className="mt-2">
          <Switch
            label={t('modals.imageTrack.perRegionColor')}
            checked={perBlobColor}
            onChange={setPerBlobColor}
          />
        </div>
        <div className="mt-2">
          <Switch label={t('modals.imageTrack.crazyColors')} checked={crazyColors} onChange={setCrazyColors} />
        </div>
      </div>

      <div className="p-2 bg-bg-tertiary rounded-md">
        <Text variant={TextVariants.heading} className="mb-2">
          {t('modals.imageTrack.labels')}
        </Text>
        <Switch label={t('modals.imageTrack.showLabels')} checked={showLabels} onChange={setShowLabels} />
        {showLabels && (
          <>
            <div className="mt-2">
              <Dropdown options={labelOptions} value={labelType} onChange={(v: LabelType) => setLabelType(v)} />
            </div>
            <div className="mt-2">
              <Text variant={TextVariants.small} className="mb-1">
                {t('modals.imageTrack.textPosition')}
              </Text>
              <Dropdown
                options={textPositionOptions}
                value={textPosition}
                onChange={(v: TextPosition) => setTextPosition(v)}
              />
            </div>
          </>
        )}
      </div>

      <div className="p-2 bg-bg-tertiary rounded-md">
        <Text variant={TextVariants.heading} className="mb-2">
          {t('modals.imageTrack.connections')}
        </Text>
        <Switch
          label={t('modals.imageTrack.showConnections')}
          checked={showConnections}
          onChange={setShowConnections}
        />
        {showConnections && (
          <>
            <div className="mt-2">
              <Dropdown
                options={connectionOptions}
                value={connectionStyle}
                onChange={(v: ConnectionStyle) => setConnectionStyle(v)}
              />
            </div>
            <div className="mt-2">
              <Switch label={t('modals.imageTrack.dashed')} checked={dashedConnections} onChange={setDashedConnections} />
            </div>
            <Slider
              label={t('modals.imageTrack.connectionRate')}
              min={0}
              max={100}
              step={1}
              value={connectionRate}
              onChange={(e: any) => setConnectionRate(parseInt(e.target.value, 10))}
            />
            {dashedConnections && (
              <>
                <Slider
                  label={t('modals.imageTrack.dashSize')}
                  min={1}
                  max={30}
                  step={1}
                  value={dashSize}
                  onChange={(e: any) => setDashSize(parseInt(e.target.value, 10))}
                />
                <Slider
                  label={t('modals.imageTrack.gapSize')}
                  min={1}
                  max={30}
                  step={1}
                  value={gapSize}
                  onChange={(e: any) => setGapSize(parseInt(e.target.value, 10))}
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );

  const renderContent = () => {
    if (savedPath) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <Text variant={TextVariants.heading} className="mb-2">
            {t('modals.imageTrack.saved')}
          </Text>
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center">
          <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <Text variant={TextVariants.heading} className="mb-2">
            {t('modals.imageTrack.errorTitle')}
          </Text>
          <Text className="max-w-xs">{error}</Text>
        </div>
      );
    }

    return (
      <div className="flex flex-row h-full w-full">
        <div className="grow flex items-center justify-center p-4 relative min-h-0 bg-bg-secondary">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-10">
              <Loader2 className="w-12 h-12 text-accent animate-spin" />
            </div>
          )}
          <canvas
            ref={canvasRef}
            className={`max-w-full max-h-full object-contain block ${manualMode ? 'cursor-crosshair' : ''}`}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={finishDraw}
            onMouseLeave={finishDraw}
          />
        </div>
        {renderControls()}
      </div>
    );
  };

  if (!isMounted) {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center z-50 bg-black/50 backdrop-blur-xs transition-opacity duration-300 ${
        show ? 'opacity-100' : 'opacity-0'
      }`}
      onMouseDown={onClose}
    >
      <AnimatePresence>
        {show && (
          <motion.div
            className="bg-surface rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden"
            onMouseDown={(e) => e.stopPropagation()}
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="grow min-h-0 overflow-hidden">{renderContent()}</div>
            <div className="shrink-0 p-4 flex justify-end gap-3 border-t border-surface bg-bg-secondary">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-md text-text-secondary hover:bg-surface transition-colors"
              >
                {savedPath ? t('modals.imageTrack.done') : t('modals.imageTrack.cancel')}
              </button>
              {!savedPath && !error && (
                <Button onClick={handleSave} disabled={isSaving || isLoading || !imageReady}>
                  {isSaving ? <Loader2 className="animate-spin mr-2" /> : <Save size={16} className="mr-2" />}
                  {isSaving ? t('modals.imageTrack.saving') : t('modals.imageTrack.saveButton')}
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
