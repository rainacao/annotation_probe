import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { Registry } from '@trrack/core';
import { useIsAnalysis } from '../../store/hooks/useIsAnalysis';
import { useStudyState } from '../../store/hooks/useStudyState';
import { useCurrentIdentifier } from '../../routes/utils';
import type { StimulusParams } from '../../store/types';
import './annotation.css';

type AnnotationPoint = {
  x: number;
  y: number;
  pressure: number;
};

type AnnotationStroke = {
  points: AnnotationPoint[];
  width: number;
  widthUnit?: 'css-px' | 'normalized-image';
  coordinateSpace?: 'annotation-area';
  color: string;
};

type AnnotationState = {
  strokes: AnnotationStroke[];
};

type ImageRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

interface AnnotationParameters {
  imageUrl: string;
  altText?: string;
}

const RESPONSE_ID = 'annotation';
const STROKE_COLOR = '#111111';
const STROKE_WIDTH_PX = 1.75;
const ANNOTATION_MARGIN_PX = 24;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isAnnotationStroke(value: unknown): value is AnnotationStroke {
  if (!isRecord(value) || !Array.isArray(value.points)) return false;
  return typeof value.width === 'number'
    && (value.widthUnit === undefined || value.widthUnit === 'css-px' || value.widthUnit === 'normalized-image')
    && (value.coordinateSpace === undefined || value.coordinateSpace === 'annotation-area')
    && typeof value.color === 'string'
    && value.points.every((point: unknown) => (
      isRecord(point)
      && typeof point.x === 'number'
      && typeof point.y === 'number'
      && typeof point.pressure === 'number'
    ));
}

function isAnnotationState(value: unknown): value is AnnotationState {
  if (!isRecord(value) || !Array.isArray(value.strokes)) return false;
  const { strokes } = value;
  return strokes.every(isAnnotationStroke);
}

function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: AnnotationStroke,
  width: number,
  height: number,
  pixelRatio: number,
  imageRect: ImageRect,
) {
  const [first, ...remaining] = stroke.points;
  if (!first) return;

  const getCanvasPoint = (point: AnnotationPoint) => {
    if (stroke.coordinateSpace === 'annotation-area') {
      return { x: point.x * width, y: point.y * height };
    }
    return {
      x: imageRect.x + point.x * imageRect.width,
      y: imageRect.y + point.y * imageRect.height,
    };
  };

  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = stroke.widthUnit === 'css-px'
    ? stroke.width * pixelRatio
    : stroke.width * Math.min(width, height);
  context.lineCap = 'round';
  context.lineJoin = 'round';

  if (!remaining.length) {
    const point = getCanvasPoint(first);
    context.beginPath();
    context.arc(point.x, point.y, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }

  const firstPoint = getCanvasPoint(first);
  context.beginPath();
  context.moveTo(firstPoint.x, firstPoint.y);
  remaining.forEach((point) => {
    const canvasPoint = getCanvasPoint(point);
    context.lineTo(canvasPoint.x, canvasPoint.y);
  });
  context.stroke();
}

function renderCanvas(
  canvas: HTMLCanvasElement,
  strokes: AnnotationStroke[],
  pixelRatio: number,
  imageRect: ImageRect,
  activeStroke?: AnnotationStroke,
) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not initialize the annotation canvas.');

  context.clearRect(0, 0, canvas.width, canvas.height);
  strokes.forEach((stroke) => drawStroke(context, stroke, canvas.width, canvas.height, pixelRatio, imageRect));
  if (activeStroke) {
    drawStroke(context, activeStroke, canvas.width, canvas.height, pixelRatio, imageRect);
  }
}

export default function AnnotationTrial({
  parameters, answers, provenanceState, setAnswer, useTrrack,
}: StimulusParams<AnnotationParameters, AnnotationState>) {
  const identifier = useCurrentIdentifier();
  const isAnalysis = useIsAnalysis();
  const readOnly = isAnalysis || provenanceState !== undefined;
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeStrokeRef = useRef<AnnotationStroke | null>(null);
  const currentStateRef = useRef<AnnotationState | null>(null);
  const savedState = answers[identifier]?.answer?.[RESPONSE_ID];
  const initialState = isAnnotationState(savedState) ? savedState : { strokes: [] };
  const [definition] = useState(() => {
    const nextRegistry = Registry.create();
    const annotation = nextRegistry.register('annotation', (_state: AnnotationState, next: AnnotationState) => next);
    return { registry: nextRegistry, annotation };
  });
  const trackedState = useTrrack<AnnotationState>({
    registry: definition.registry,
    initialState,
  });
  const restoredState = useStudyState({ trrack: trackedState });
  const [localState, setLocalState] = useState<AnnotationState>(restoredState);
  const visibleState = provenanceState ?? localState;
  const canEdit = !readOnly;
  currentStateRef.current = localState;

  useEffect(() => {
    if (provenanceState) return;
    setLocalState(restoredState);
  }, [provenanceState, restoredState]);

  const publishState = useCallback((nextState: AnnotationState, action: string) => {
    currentStateRef.current = nextState;
    setLocalState(nextState);
    trackedState.apply(action, definition.annotation(nextState));
    setAnswer({
      status: true,
      answers: { [RESPONSE_ID]: nextState },
    });
  }, [definition.annotation, setAnswer, trackedState]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const image = imageRef.current;
    const stage = stageRef.current;
    if (!image || !stage) return;
    const imageBounds = image.getBoundingClientRect();
    const stageBounds = stage.getBoundingClientRect();
    if (!image.complete || !imageBounds.width || !imageBounds.height) {
      canvas.style.pointerEvents = 'none';
      return;
    }

    const canvasLeft = Math.max(stageBounds.left, imageBounds.left - ANNOTATION_MARGIN_PX);
    const canvasTop = Math.max(stageBounds.top, imageBounds.top - ANNOTATION_MARGIN_PX);
    const canvasRight = Math.min(stageBounds.right, imageBounds.right + ANNOTATION_MARGIN_PX);
    const canvasBottom = Math.min(stageBounds.bottom, imageBounds.bottom + ANNOTATION_MARGIN_PX);
    const canvasWidth = canvasRight - canvasLeft;
    const canvasHeight = canvasBottom - canvasTop;
    if (!canvasWidth || !canvasHeight) {
      canvas.style.pointerEvents = 'none';
      return;
    }
    canvas.style.left = `${canvasLeft - stageBounds.left}px`;
    canvas.style.top = `${canvasTop - stageBounds.top}px`;
    canvas.style.right = 'auto';
    canvas.style.bottom = 'auto';
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;
    canvas.style.pointerEvents = canEdit ? 'auto' : 'none';

    const pixelRatio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(canvasWidth * pixelRatio);
    const pixelHeight = Math.round(canvasHeight * pixelRatio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const imageRect = {
      x: (imageBounds.left - canvasLeft) * pixelRatio,
      y: (imageBounds.top - canvasTop) * pixelRatio,
      width: imageBounds.width * pixelRatio,
      height: imageBounds.height * pixelRatio,
    };
    renderCanvas(canvas, visibleState.strokes, pixelRatio, imageRect, activeStrokeRef.current ?? undefined);
  }, [canEdit, visibleState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const observer = new ResizeObserver(redraw);
    if (stageRef.current) observer.observe(stageRef.current);
    if (imageRef.current) observer.observe(imageRef.current);
    redraw();
    return () => observer.disconnect();
  }, [redraw]);

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>, clampToImage = false): AnnotationPoint | null => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;
    if (!clampToImage && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
    return {
      x: Math.min(1, Math.max(0, x)),
      y: Math.min(1, Math.max(0, y)),
      pressure: event.pressure || 0.5,
    };
  };

  const finishStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const activeStroke = activeStrokeRef.current;
    if (!activeStroke) return;

    const point = getPoint(event, true);
    if (point) activeStroke.points.push(point);
    activeStrokeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const nextState = {
      strokes: [...(currentStateRef.current?.strokes ?? []), activeStroke],
    };
    publishState(nextState, 'Draw stroke');
  };

  const undo = () => {
    const strokes = currentStateRef.current?.strokes ?? [];
    if (!strokes.length) return;
    publishState({ strokes: strokes.slice(0, -1) }, 'Undo stroke');
  };

  const clear = () => {
    if (!currentStateRef.current?.strokes.length) return;
    publishState({ strokes: [] }, 'Clear annotations');
  };

  const hasStrokes = visibleState.strokes.length > 0;
  return (
    <section className="annotation-trial" aria-label="Graph annotation task">
      <div className="annotation-controls">
        <span>Draw on the graph with your mouse, finger, or stylus.</span>
        <div className="annotation-actions">
          <button type="button" onClick={undo} disabled={!canEdit || !hasStrokes}>Undo</button>
          <button type="button" onClick={clear} disabled={!canEdit || !hasStrokes}>Clear</button>
        </div>
      </div>
      <div ref={stageRef} className="annotation-image-stage">
        <img ref={imageRef} src={parameters.imageUrl} alt={parameters.altText || 'VLAT graph stimulus'} draggable={false} onLoad={redraw} />
        <canvas
          ref={canvasRef}
          className="annotation-layer"
          aria-label="Draw annotations over the graph"
          role="application"
          style={{ touchAction: canEdit ? 'none' : 'auto' }}
          onPointerDown={(event) => {
            if (!canEdit || (event.pointerType === 'mouse' && event.button !== 0)) return;
            const point = getPoint(event);
            if (!point) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            activeStrokeRef.current = {
              points: [point],
              width: STROKE_WIDTH_PX,
              widthUnit: 'css-px',
              coordinateSpace: 'annotation-area',
              color: STROKE_COLOR,
            };
            redraw();
          }}
          onPointerMove={(event) => {
            if (!canEdit || !activeStrokeRef.current) return;
            const point = getPoint(event, true);
            if (point) activeStrokeRef.current.points.push(point);
            redraw();
          }}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          onLostPointerCapture={() => {
            if (activeStrokeRef.current) {
              activeStrokeRef.current = null;
              redraw();
            }
          }}
        />
      </div>
    </section>
  );
}
