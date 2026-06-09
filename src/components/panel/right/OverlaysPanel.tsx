import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { Eye, EyeOff, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { Adjustments, Overlay } from '../../../utils/adjustments';
import {
  AUTO_PATTERNS,
  AutoPattern,
  OverlayAsset,
  cleanAndRecolorSvg,
  createOverlay,
  frameSvgToContent,
  generateAutoOverlays,
  getRawOverlaySvg,
  listOverlayAssets,
  svgToDataUrl,
} from '../../../utils/overlays';
import { useEditorStore } from '../../../store/useEditorStore';
import { useUIStore } from '../../../store/useUIStore';
import { useEditorActions } from '../../../hooks/useEditorActions';
import Slider, { SliderChangeEvent } from '../../ui/Slider';

const CHECKER_STYLE: React.CSSProperties = {
  backgroundColor: '#3a3a3a',
  backgroundImage:
    'linear-gradient(45deg, #555 25%, transparent 25%), linear-gradient(-45deg, #555 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #555 75%), linear-gradient(-45deg, transparent 75%, #555 75%)',
  backgroundSize: '12px 12px',
  backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0px',
};

function AssetThumb({
  source,
  color,
  contentBox,
}: {
  source: string;
  color: string | null;
  contentBox?: number[] | null;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getRawOverlaySvg(source)
      .then((svg) => {
        if (active) {
          setUrl(svgToDataUrl(frameSvgToContent(cleanAndRecolorSvg(svg, color), contentBox)));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [source, color, contentBox]);

  if (!url) {
    return <div className="w-full h-full" />;
  }
  return <img src={url} alt="" className="w-full h-full object-contain p-1.5" draggable={false} />;
}

export default function OverlaysPanel() {
  const { t } = useTranslation();
  const { setAdjustments } = useEditorActions();
  const { adjustments, selectedImage } = useEditorStore(
    useShallow((state) => ({
      adjustments: state.adjustments as Adjustments,
      selectedImage: state.selectedImage,
    })),
  );
  const { activeOverlayId, setUI } = useUIStore(
    useShallow((state) => ({ activeOverlayId: state.activeOverlayId, setUI: state.setUI })),
  );

  const [assets, setAssets] = useState<OverlayAsset[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const [autoPattern, setAutoPattern] = useState<AutoPattern>('scatter');
  const [autoCount, setAutoCount] = useState(6);
  const [autoSize, setAutoSize] = useState(22);
  const [autoSizeRandom, setAutoSizeRandom] = useState(40);

  useEffect(() => {
    let active = true;
    listOverlayAssets()
      .then((list) => {
        if (active) {
          setAssets(list);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const categories = useMemo(() => [...new Set(assets.map((a) => a.category))], [assets]);

  useEffect(() => {
    if (!activeCategory && categories.length > 0) {
      setActiveCategory(categories[0]);
    }
  }, [categories, activeCategory]);

  const visibleAssets = useMemo(
    () => assets.filter((a) => a.category === activeCategory),
    [assets, activeCategory],
  );

  const overlays: Array<Overlay> = adjustments.overlays || [];
  const selectedOverlay = overlays.find((o) => o.id === activeOverlayId) || null;

  const addOverlay = (asset: OverlayAsset) => {
    const overlay = createOverlay(asset);
    setAdjustments((prev: Adjustments) => ({ ...prev, overlays: [...(prev.overlays || []), overlay] }));
    setUI({ activeOverlayId: overlay.id });
  };

  const updateOverlay = (id: string, patch: Partial<Overlay>) => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      overlays: (prev.overlays || []).map((o) => (o.id === id ? { ...o, ...patch } : o)),
    }));
  };

  const removeOverlay = (id: string) => {
    setAdjustments((prev: Adjustments) => ({
      ...prev,
      overlays: (prev.overlays || []).filter((o) => o.id !== id),
    }));
    if (activeOverlayId === id) {
      setUI({ activeOverlayId: null });
    }
  };

  const clearOverlays = () => {
    setAdjustments((prev: Adjustments) => ({ ...prev, overlays: [] }));
    setUI({ activeOverlayId: null });
  };

  const runAutoArrange = () => {
    // Prefer the "Design Layouts" family for auto-arrange; fall back to whatever is loaded.
    const designAssets = assets.filter((a) => a.category.toLowerCase().includes('design'));
    const pool = designAssets.length > 0 ? designAssets : assets;
    const generated = generateAutoOverlays(
      { pattern: autoPattern, count: autoCount, size: autoSize / 100, sizeRandomness: autoSizeRandom / 100 },
      pool,
      selectedImage?.width || 1,
      selectedImage?.height || 1,
    );
    if (generated.length === 0) {
      return;
    }
    setAdjustments((prev: Adjustments) => ({ ...prev, overlays: [...(prev.overlays || []), ...generated] }));
    setUI({ activeOverlayId: null });
  };

  // Delete / Backspace removes the selected overlay (capture phase beats the global shortcuts).
  useEffect(() => {
    if (!activeOverlayId) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      removeOverlay(activeOverlayId);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [activeOverlayId]);

  if (!selectedImage) {
    return null;
  }

  return (
    <div className="flex flex-col h-full text-text-primary p-2 gap-3 overflow-y-auto">
      <div>
        <h2 className="text-lg font-semibold">{t('overlays.title')}</h2>
        <p className="text-sm text-text-secondary">{t('overlays.description')}</p>
      </div>

      {/* Auto arrange */}
      <div className="border border-surface rounded-md p-2 flex flex-col gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Sparkles size={15} />
          {t('overlays.auto.title')}
        </h3>
        <div className="flex flex-wrap gap-1">
          {AUTO_PATTERNS.map((pattern) => (
            <button
              key={pattern}
              onClick={() => setAutoPattern(pattern)}
              className={`px-2 py-1 rounded-md text-xs capitalize transition-colors ${
                autoPattern === pattern
                  ? 'bg-accent text-button-text'
                  : 'bg-surface text-text-secondary hover:text-text-primary'
              }`}
            >
              {t(`overlays.auto.patterns.${pattern}`)}
            </button>
          ))}
        </div>
        <Slider
          label={t('overlays.auto.count')}
          min={1}
          max={24}
          step={1}
          value={autoCount}
          onChange={(e: SliderChangeEvent) => setAutoCount(Math.round(parseFloat(String(e.target.value))))}
        />
        <Slider
          label={t('overlays.auto.size')}
          min={4}
          max={60}
          step={1}
          value={autoSize}
          onChange={(e: SliderChangeEvent) => setAutoSize(parseFloat(String(e.target.value)))}
        />
        <Slider
          label={t('overlays.auto.sizeRandomness')}
          min={0}
          max={100}
          step={1}
          value={autoSizeRandom}
          onChange={(e: SliderChangeEvent) => setAutoSizeRandom(parseFloat(String(e.target.value)))}
        />
        <div className="flex gap-2 mt-1">
          <button
            onClick={runAutoArrange}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-accent text-button-text text-sm hover:opacity-90 transition-opacity"
          >
            <Sparkles size={15} />
            {t('overlays.auto.generate')}
          </button>
          <button
            onClick={clearOverlays}
            className="px-2 py-1.5 rounded-md bg-surface text-text-secondary hover:text-text-primary text-sm"
          >
            {t('overlays.auto.clear')}
          </button>
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-1">
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => setActiveCategory(category)}
            className={`px-2 py-1 rounded-md text-xs transition-colors ${
              activeCategory === category
                ? 'bg-accent text-button-text'
                : 'bg-surface text-text-secondary hover:text-text-primary'
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      {/* Asset browser */}
      <div className="grid grid-cols-4 gap-2">
        {visibleAssets.map((asset) => (
          <button
            key={asset.source}
            onClick={() => addOverlay(asset)}
            data-tooltip={asset.name}
            className="aspect-square rounded-md overflow-hidden border border-surface hover:border-accent transition-colors relative group"
            style={CHECKER_STYLE}
          >
            <AssetThumb source={asset.source} color={null} contentBox={asset.contentBox} />
            <span className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
              <Plus size={18} className="text-white" />
            </span>
          </button>
        ))}
      </div>

      {/* Placed overlays */}
      <div className="border-t border-surface pt-2">
        <h3 className="text-sm font-semibold mb-2">{t('overlays.placed')}</h3>
        {overlays.length === 0 ? (
          <p className="text-xs text-text-secondary">{t('overlays.empty')}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {overlays.map((overlay) => (
              <div
                key={overlay.id}
                onClick={() => setUI({ activeOverlayId: overlay.id })}
                className={`flex items-center gap-2 p-1.5 rounded-md cursor-pointer ${
                  activeOverlayId === overlay.id ? 'bg-surface' : 'hover:bg-surface/60'
                }`}
              >
                <div className="w-8 h-8 rounded shrink-0 overflow-hidden" style={CHECKER_STYLE}>
                  <AssetThumb source={overlay.source} color={overlay.color} contentBox={overlay.contentBox} />
                </div>
                <span className="flex-1 text-sm truncate">{overlay.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    updateOverlay(overlay.id, { visible: !overlay.visible });
                  }}
                  className="p-1 text-text-secondary hover:text-text-primary"
                  data-tooltip={overlay.visible ? t('overlays.hide') : t('overlays.show')}
                >
                  {overlay.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeOverlay(overlay.id);
                  }}
                  className="p-1 text-text-secondary hover:text-red-500"
                  data-tooltip={t('overlays.remove')}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Selected overlay controls */}
      {selectedOverlay && (
        <div className="border-t border-surface pt-3 flex flex-col gap-3">
          <h3 className="text-sm font-semibold">{t('overlays.adjust')}</h3>

          <div className="flex items-center gap-2">
            <span className="text-sm text-text-secondary flex-1">{t('overlays.color')}</span>
            <input
              type="color"
              value={selectedOverlay.color ?? '#ffffff'}
              onChange={(e) => updateOverlay(selectedOverlay.id, { color: e.target.value })}
              className="w-8 h-8 p-0 border-none rounded-sm cursor-pointer bg-transparent"
            />
            <button
              onClick={() => updateOverlay(selectedOverlay.id, { color: null })}
              disabled={selectedOverlay.color === null}
              className="p-1.5 rounded-md bg-surface text-text-secondary hover:text-text-primary disabled:opacity-40"
              data-tooltip={t('overlays.resetColor')}
            >
              <RotateCcw size={16} />
            </button>
          </div>

          <Slider
            label={t('overlays.size')}
            min={1}
            max={150}
            step={1}
            value={Math.round(selectedOverlay.scale * 100)}
            onChange={(e: SliderChangeEvent) =>
              updateOverlay(selectedOverlay.id, { scale: parseFloat(String(e.target.value)) / 100 })
            }
          />
          <Slider
            label={t('overlays.rotation')}
            min={-180}
            max={180}
            step={1}
            value={selectedOverlay.rotation}
            onChange={(e: SliderChangeEvent) =>
              updateOverlay(selectedOverlay.id, { rotation: parseFloat(String(e.target.value)) })
            }
          />
          <Slider
            label={t('overlays.opacity')}
            min={0}
            max={100}
            step={1}
            value={selectedOverlay.opacity}
            onChange={(e: SliderChangeEvent) =>
              updateOverlay(selectedOverlay.id, { opacity: parseFloat(String(e.target.value)) })
            }
          />
        </div>
      )}
    </div>
  );
}
