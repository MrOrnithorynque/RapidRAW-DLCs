import { useEffect, useRef, useState } from 'react';
import { Image as KonvaImage, Transformer } from 'react-konva';
import type Konva from 'konva';
import { Overlay } from '../../../utils/adjustments';
import { loadOverlayImage } from '../../../utils/overlays';

interface OverlayNodeProps {
  overlay: Overlay;
  // Displayed (cropped) image size in logical stage px — overlays are normalized to this,
  // matching the backend's output-relative compositing.
  stageWidth: number;
  stageHeight: number;
  stageScale: number;
  isSelected: boolean;
  onSelect(): void;
  onChange(patch: Partial<Overlay>): void;
  onInteractionEnd(): void;
}

export default function OverlayNode({
  overlay,
  stageWidth,
  stageHeight,
  stageScale,
  isSelected,
  onSelect,
  onChange,
  onInteractionEnd,
}: OverlayNodeProps) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const shapeRef = useRef<Konva.Image>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    let active = true;
    loadOverlayImage(overlay.source, overlay.color)
      .then((loaded) => {
        if (active) {
          setImg(loaded);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [overlay.source, overlay.color]);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected, img, stageWidth, stageHeight]);

  if (!img || !overlay.visible) {
    return null;
  }

  // Frame to the tight content box (margins trimmed) when available, else the whole SVG.
  const box = overlay.contentBox && overlay.contentBox.length === 4 ? overlay.contentBox : null;
  const cropPx = box
    ? {
        x: box[0] * img.naturalWidth,
        y: box[1] * img.naturalHeight,
        width: box[2] * img.naturalWidth,
        height: box[3] * img.naturalHeight,
      }
    : undefined;
  const contentW = cropPx ? cropPx.width : img.naturalWidth;
  const contentH = cropPx ? cropPx.height : img.naturalHeight;
  const aspect = contentW > 0 && contentH > 0 ? contentW / contentH : 1;
  const minDim = Math.min(stageWidth, stageHeight);
  const width = Math.max(1, overlay.scale * minDim);
  const height = width / aspect;
  const centerX = overlay.x * stageWidth;
  const centerY = overlay.y * stageHeight;
  const handle = 1 / (stageScale || 1);

  return (
    <>
      <KonvaImage
        ref={shapeRef}
        image={img}
        crop={cropPx}
        x={centerX}
        y={centerY}
        width={width}
        height={height}
        offsetX={width / 2}
        offsetY={height / 2}
        rotation={overlay.rotation}
        opacity={Math.max(0, Math.min(1, overlay.opacity / 100))}
        draggable
        onMouseDown={onSelect}
        onTap={onSelect}
        onDragStart={onSelect}
        onDragEnd={(e) => {
          const node = e.target;
          onChange({ x: node.x() / stageWidth, y: node.y() / stageHeight });
          onInteractionEnd();
        }}
        onTransformEnd={() => {
          const node = shapeRef.current;
          if (!node) {
            return;
          }
          const newWidth = Math.max(1, width * node.scaleX());
          node.scaleX(1);
          node.scaleY(1);
          onChange({
            scale: newWidth / minDim,
            rotation: node.rotation(),
            x: node.x() / stageWidth,
            y: node.y() / stageHeight,
          });
          onInteractionEnd();
        }}
      />
      {isSelected && (
        <Transformer
          ref={trRef}
          keepRatio
          rotationSnaps={[0, 90, 180, 270]}
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
          anchorSize={10 * handle}
          anchorStrokeWidth={handle}
          borderStrokeWidth={handle}
          rotateAnchorOffset={24 * handle}
          boundBoxFunc={(oldBox, newBox) => (newBox.width < 5 || newBox.height < 5 ? oldBox : newBox)}
        />
      )}
    </>
  );
}
