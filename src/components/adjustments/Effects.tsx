import { useTranslation } from 'react-i18next';
import { ScanSearch } from 'lucide-react';
import Slider from '../ui/Slider';
import { Adjustments, Effect, CreativeAdjustment, StyleEffect } from '../../utils/adjustments';
import LUTControl from '../ui/LUTControl';
import Dropdown from '../ui/Dropdown';
import Button from '../ui/Button';
import Switch from '../ui/Switch';
import { AppSettings } from '../ui/AppProperties';
import Text from '../ui/Text';
import { TextVariants } from '../../types/typography';
import { useUIStore } from '../../store/useUIStore';
import { useEditorStore } from '../../store/useEditorStore';

interface EffectsPanelProps {
  adjustments: Adjustments;
  isForMask: boolean;
  setAdjustments(adjustments: Partial<Adjustments>): any;
  handleLutSelect(path: string): void;
  appSettings: AppSettings | null;
  onDragStateChange?: (isDragging: boolean) => void;
}

export default function EffectsPanel({
  adjustments,
  setAdjustments,
  isForMask = false,
  handleLutSelect,
  appSettings,
  onDragStateChange,
}: EffectsPanelProps) {
  const { t } = useTranslation();

  const setUI = useUIStore((state) => state.setUI);
  const selectedImagePath = useEditorStore((state) => state.selectedImage?.path ?? null);

  const handleOpenImageTrack = () => {
    if (selectedImagePath) {
      setUI({ imageTrackModalState: { isOpen: true, sourcePath: selectedImagePath } });
    }
  };

  const handleAdjustmentChange = (key: string, value: string) => {
    const numericValue = parseInt(value, 10);
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [key]: numericValue }));
  };

  const setEffectEnabled = (key: string, val: boolean) => {
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, [key]: val }));
  };

  const handleLutIntensityChange = (intensity: number) => {
    setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, lutIntensity: intensity }));
  };

  const handleLutClear = () => {
    setAdjustments((prev: Partial<Adjustments>) => ({
      ...prev,
      lutPath: null,
      lutName: null,
      lutData: null,
      lutSize: 0,
      lutIntensity: 100,
    }));
  };

  const adjustmentVisibility = appSettings?.adjustmentVisibility || {};

  return (
    <div className="space-y-4">
      <div className="p-2 bg-bg-tertiary rounded-md">
        <Text variant={TextVariants.heading} className="mb-2">
          {t('adjustments.effects.creative')}
        </Text>

        <Slider
          label={t('adjustments.effects.glow')}
          max={100}
          min={0}
          onChange={(e: any) => handleAdjustmentChange(CreativeAdjustment.GlowAmount, e.target.value)}
          step={1}
          value={adjustments.glowAmount}
          onDragStateChange={onDragStateChange}
        />

        <Slider
          label={t('adjustments.effects.halation')}
          max={100}
          min={0}
          onChange={(e: any) => handleAdjustmentChange(CreativeAdjustment.HalationAmount, e.target.value)}
          step={1}
          value={adjustments.halationAmount}
          onDragStateChange={onDragStateChange}
        />

        {!isForMask && (
          <Slider
            label={t('adjustments.effects.lightFlares')}
            max={100}
            min={0}
            onChange={(e: any) => handleAdjustmentChange(CreativeAdjustment.FlareAmount, e.target.value)}
            step={1}
            value={adjustments.flareAmount}
            onDragStateChange={onDragStateChange}
          />
        )}
      </div>

      {!isForMask && (
        <div className="space-y-4">
          <div className="p-2 bg-bg-tertiary rounded-md">
            <Text variant={TextVariants.heading} className="mb-2">
              {t('adjustments.effects.lut')}
            </Text>
            <LUTControl
              lutName={adjustments.lutName || null}
              lutIntensity={adjustments.lutIntensity || 100}
              onLutSelect={handleLutSelect}
              onIntensityChange={handleLutIntensityChange}
              onClear={handleLutClear}
              onDragStateChange={onDragStateChange}
            />
          </div>

          {adjustmentVisibility.vignette !== false && (
            <div className="p-2 bg-bg-tertiary rounded-md">
              <Text variant={TextVariants.heading} className="mb-2">
                {t('adjustments.effects.vignette')}
              </Text>
              <Slider
                label={t('adjustments.effects.amount')}
                max={100}
                min={-100}
                onChange={(e: any) => handleAdjustmentChange(Effect.VignetteAmount, e.target.value)}
                step={1}
                value={adjustments.vignetteAmount}
                onDragStateChange={onDragStateChange}
              />
              <Slider
                defaultValue={50}
                label={t('adjustments.effects.midpoint')}
                max={100}
                min={0}
                onChange={(e: any) => handleAdjustmentChange(Effect.VignetteMidpoint, e.target.value)}
                step={1}
                value={adjustments.vignetteMidpoint}
                onDragStateChange={onDragStateChange}
                fillOrigin="min"
              />
              <Slider
                label={t('adjustments.effects.roundness')}
                max={100}
                min={-100}
                onChange={(e: any) => handleAdjustmentChange(Effect.VignetteRoundness, e.target.value)}
                step={1}
                value={adjustments.vignetteRoundness}
                onDragStateChange={onDragStateChange}
              />
              <Slider
                defaultValue={50}
                label={t('adjustments.effects.feather')}
                max={100}
                min={0}
                onChange={(e: any) => handleAdjustmentChange(Effect.VignetteFeather, e.target.value)}
                step={1}
                value={adjustments.vignetteFeather}
                onDragStateChange={onDragStateChange}
                fillOrigin="min"
              />
            </div>
          )}

          {adjustmentVisibility.grain !== false && (
            <div className="p-2 bg-bg-tertiary rounded-md">
              <Text variant={TextVariants.heading} className="mb-2">
                {t('adjustments.effects.grain')}
              </Text>
              <Slider
                label={t('adjustments.effects.amount')}
                max={100}
                min={0}
                onChange={(e: any) => handleAdjustmentChange(Effect.GrainAmount, e.target.value)}
                step={1}
                value={adjustments.grainAmount}
                onDragStateChange={onDragStateChange}
              />
              <Slider
                defaultValue={25}
                label={t('adjustments.effects.size')}
                max={100}
                min={0}
                onChange={(e: any) => handleAdjustmentChange(Effect.GrainSize, e.target.value)}
                step={1}
                value={adjustments.grainSize}
                onDragStateChange={onDragStateChange}
                fillOrigin="min"
              />
              <Slider
                defaultValue={50}
                label={t('adjustments.effects.roughness')}
                max={100}
                min={0}
                onChange={(e: any) => handleAdjustmentChange(Effect.GrainRoughness, e.target.value)}
                step={1}
                value={adjustments.grainRoughness}
                onDragStateChange={onDragStateChange}
                fillOrigin="min"
              />
            </div>
          )}

          <div className="p-2 bg-bg-tertiary rounded-md">
            <div className="mb-2">
              <Switch
                label={t('adjustments.effects.halftone')}
                checked={adjustments.halftoneEnabled !== false}
                onChange={(v: boolean) => setEffectEnabled('halftoneEnabled', v)}
              />
            </div>
            <Slider
              label={t('adjustments.effects.amount')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.HalftoneAmount, e.target.value)}
              step={1}
              value={adjustments.halftoneAmount}
              onDragStateChange={onDragStateChange}
            />
            <div className="my-2">
              <Dropdown
                options={[
                  { label: t('adjustments.effects.shapeDot'), value: 0 },
                  { label: t('adjustments.effects.shapeLine'), value: 1 },
                  { label: t('adjustments.effects.shapeCross'), value: 2 },
                ]}
                value={adjustments.halftoneShape}
                onChange={(value: number) =>
                  setAdjustments((prev: Partial<Adjustments>) => ({ ...prev, halftoneShape: value }))
                }
              />
            </div>
            <Slider
              defaultValue={6}
              label={t('adjustments.effects.size')}
              max={40}
              min={2}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.HalftoneScale, e.target.value)}
              step={1}
              value={adjustments.halftoneScale}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <Slider
              defaultValue={45}
              label={t('adjustments.effects.angle')}
              max={360}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.HalftoneAngle, e.target.value)}
              step={1}
              value={adjustments.halftoneAngle}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
          </div>

          <div className="p-2 bg-bg-tertiary rounded-md">
            <div className="mb-2">
              <Switch
                label={t('adjustments.effects.scanlines')}
                checked={adjustments.scanlinesEnabled !== false}
                onChange={(v: boolean) => setEffectEnabled('scanlinesEnabled', v)}
              />
            </div>
            <Slider
              label={t('adjustments.effects.amount')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.ScanlineAmount, e.target.value)}
              step={1}
              value={adjustments.scanlineAmount}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              defaultValue={240}
              label={t('adjustments.effects.lineCount')}
              max={1000}
              min={20}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.ScanlineCount, e.target.value)}
              step={1}
              value={adjustments.scanlineCount}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <Slider
              label={t('adjustments.effects.noise')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.ScanlineNoise, e.target.value)}
              step={1}
              value={adjustments.scanlineNoise}
              onDragStateChange={onDragStateChange}
            />
          </div>

          <div className="p-2 bg-bg-tertiary rounded-md">
            <div className="mb-2">
              <Switch
                label={t('adjustments.effects.stylize')}
                checked={adjustments.stylizeEnabled !== false}
                onChange={(v: boolean) => setEffectEnabled('stylizeEnabled', v)}
              />
            </div>
            <Slider
              label={t('adjustments.effects.monochrome')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.MonoAmount, e.target.value)}
              step={1}
              value={adjustments.monoAmount}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              label={t('adjustments.effects.posterize')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.PosterizeAmount, e.target.value)}
              step={1}
              value={adjustments.posterizeAmount}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              defaultValue={6}
              label={t('adjustments.effects.levels')}
              max={16}
              min={2}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.PosterizeLevels, e.target.value)}
              step={1}
              value={adjustments.posterizeLevels}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <Slider
              defaultValue={0}
              label={t('adjustments.effects.hueRotate')}
              max={180}
              min={-180}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.HueRotate, e.target.value)}
              step={1}
              value={adjustments.hueRotate}
              onDragStateChange={onDragStateChange}
            />
          </div>

          <div className="p-2 bg-bg-tertiary rounded-md">
            <div className="mb-2">
              <Switch
                label={t('adjustments.effects.glitch')}
                checked={adjustments.glitchEnabled !== false}
                onChange={(v: boolean) => setEffectEnabled('glitchEnabled', v)}
              />
            </div>
            <Slider
              label={t('adjustments.effects.amount')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.GlitchAmount, e.target.value)}
              step={1}
              value={adjustments.glitchAmount}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              defaultValue={40}
              label={t('adjustments.effects.rgbSplit')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.GlitchRgbSplit, e.target.value)}
              step={1}
              value={adjustments.glitchRgbSplit}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <Slider
              defaultValue={40}
              label={t('adjustments.effects.blocks')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.GlitchBlocks, e.target.value)}
              step={1}
              value={adjustments.glitchBlocks}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <Slider
              defaultValue={30}
              label={t('adjustments.effects.noise')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.GlitchNoise, e.target.value)}
              step={1}
              value={adjustments.glitchNoise}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
          </div>

          <div className="p-2 bg-bg-tertiary rounded-md">
            <div className="mb-2">
              <Switch
                label={t('adjustments.effects.glass')}
                checked={adjustments.glassEnabled !== false}
                onChange={(v: boolean) => setEffectEnabled('glassEnabled', v)}
              />
            </div>
            <Slider
              label={t('adjustments.effects.amount')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.GlassAmount, e.target.value)}
              step={1}
              value={adjustments.glassAmount}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              defaultValue={8}
              label={t('adjustments.effects.size')}
              max={40}
              min={1}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.GlassScale, e.target.value)}
              step={1}
              value={adjustments.glassScale}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
            <Slider
              defaultValue={50}
              label={t('adjustments.effects.strength')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.GlassStrength, e.target.value)}
              step={1}
              value={adjustments.glassStrength}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
          </div>

          <div className="p-2 bg-bg-tertiary rounded-md">
            <div className="mb-2">
              <Switch
                label={t('adjustments.effects.distort')}
                checked={adjustments.distortEnabled !== false}
                onChange={(v: boolean) => setEffectEnabled('distortEnabled', v)}
              />
            </div>
            <Slider
              label={t('adjustments.effects.pixelate')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.PixelateAmount, e.target.value)}
              step={1}
              value={adjustments.pixelateAmount}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              label={t('adjustments.effects.wave')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.WaveAmount, e.target.value)}
              step={1}
              value={adjustments.waveAmount}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              defaultValue={12}
              label={t('adjustments.effects.frequency')}
              max={40}
              min={1}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.WaveFrequency, e.target.value)}
              step={1}
              value={adjustments.waveFrequency}
              onDragStateChange={onDragStateChange}
              fillOrigin="min"
            />
          </div>

          <div className="p-2 bg-bg-tertiary rounded-md">
            <div className="mb-2">
              <Switch
                label={t('adjustments.effects.artistic')}
                checked={adjustments.artisticEnabled !== false}
                onChange={(v: boolean) => setEffectEnabled('artisticEnabled', v)}
              />
            </div>
            <Slider
              label={t('adjustments.effects.edgeDetect')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.EdgeAmount, e.target.value)}
              step={1}
              value={adjustments.edgeAmount}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              label={t('adjustments.effects.thermal')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.ThermalAmount, e.target.value)}
              step={1}
              value={adjustments.thermalAmount}
              onDragStateChange={onDragStateChange}
            />
            <Slider
              label={t('adjustments.effects.xray')}
              max={100}
              min={0}
              onChange={(e: any) => handleAdjustmentChange(StyleEffect.XrayAmount, e.target.value)}
              step={1}
              value={adjustments.xrayAmount}
              onDragStateChange={onDragStateChange}
            />
          </div>

          <div className="p-2 bg-bg-tertiary rounded-md">
            <Text variant={TextVariants.heading} className="mb-2">
              {t('adjustments.effects.imageTrack')}
            </Text>
            <Text variant={TextVariants.small} className="text-text-secondary mb-2 block">
              {t('adjustments.effects.imageTrackDesc')}
            </Text>
            <Button onClick={handleOpenImageTrack} disabled={!selectedImagePath} className="w-full justify-center">
              <ScanSearch size={16} className="mr-2" />
              {t('adjustments.effects.openImageTrack')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
