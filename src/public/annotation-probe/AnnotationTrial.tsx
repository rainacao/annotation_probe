import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { Registry } from '@trrack/core';
import { useIsAnalysis } from '../../store/hooks/useIsAnalysis';
import { useStudyState } from '../../store/hooks/useStudyState';
import { useCurrentIdentifier } from '../../routes/utils';
import type { StimulusParams } from '../../store/types';
import './annotation.css';

// Same shape as reVISit windowEvents: [epoch ms, action, data].
// Point and image coordinates: x/y are fractions of the graph image (0-1 inside it; <0 or >1 in the drawable margin).
type AnnotationPoint = [t: number, x: number, y: number];
type DrawEvent = [number, 'draw', {
  /** Epoch ms of the last point. */
  end: number;
  /** Graph image bounds in viewport CSS px when the mark started: [left, top, width, height]. */
  image: [number, number, number, number];
  points: AnnotationPoint[];
}];
/** Data is the index (in annotationEvents) of the draw event that was removed. */
type UndoEvent = [number, 'undo', number];
/** Data is the indices (in annotationEvents) of the draw events that were removed. */
type ClearEvent = [number, 'clear', number[]];
type AnnotationEvent = DrawEvent | UndoEvent | ClearEvent;

type AnnotationState = {
  annotationEvents: AnnotationEvent[];
};

type ActiveStroke = DrawEvent[2] & { start: number };

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

const RESPONSE_ID = 'annotationEvents';
const STROKE_COLOR = '#111111';
const STROKE_WIDTH_PX = 1.75;
const ANNOTATION_MARGIN_PX = 24;
const COORDINATE_DECIMALS = 4;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function isNumberArray(value: unknown, length?: number): value is number[] {
  return Array.isArray(value)
    && (length === undefined || value.length === length)
    && value.every((item) => typeof item === 'number');
}

function isAnnotationEvent(value: unknown): value is AnnotationEvent {
  if (!Array.isArray(value) || value.length !== 3 || typeof value[0] !== 'number') return false;
  const [, action, data] = value;
  if (action === 'undo') return typeof data === 'number';
  if (action === 'clear') return isNumberArray(data);
  return action === 'draw'
    && isRecord(data)
    && typeof data.end === 'number'
    && isNumberArray(data.image, 4)
    && Array.isArray(data.points)
    && data.points.every((point: unknown) => isNumberArray(point, 3));
}

function isAnnotationEvents(value: unknown): value is AnnotationEvent[] {
  return Array.isArray(value) && value.every(isAnnotationEvent);
}

/** Replays the event log into the indices of the draw events that are still visible. */
function getVisibleDrawIndices(events: AnnotationEvent[]): number[] {
  const visible: number[] = [];
  events.forEach((event, index) => {
    if (event[1] === 'draw') visible.push(index);
    else if (event[1] === 'undo') visible.splice(visible.lastIndexOf(event[2]), 1);
    else visible.length = 0;
  });
  return visible;
}

function roundCoordinate(value: number) {
  return Number(value.toFixed(COORDINATE_DECIMALS));
}

function roundPx(value: number) {
  return Number(value.toFixed(1));
}

function drawStroke(
  context: CanvasRenderingContext2D,
  points: AnnotationPoint[],
  pixelRatio: number,
  imageRect: ImageRect,
) {
  const [first, ...remaining] = points;
  if (!first) return;

  const getCanvasPoint = ([, x, y]: AnnotationPoint) => ({
    x: imageRect.x + x * imageRect.width,
    y: imageRect.y + y * imageRect.height,
  });

  context.strokeStyle = STROKE_COLOR;
  context.fillStyle = STROKE_COLOR;
  context.lineWidth = STROKE_WIDTH_PX * pixelRatio;
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
  strokes: AnnotationPoint[][],
  pixelRatio: number,
  imageRect: ImageRect,
) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not initialize the annotation canvas.');

  context.clearRect(0, 0, canvas.width, canvas.height);
  strokes.forEach((points) => drawStroke(context, points, pixelRatio, imageRect));
}

export default function AnnotationTrial({
  parameters, answers, provenanceState, setAnswer, useTrrack,
}: StimulusParams<AnnotationParameters, AnnotationState>) {
  const identifier = useCurrentIdentifier();
  const isAnalysis = useIsAnalysis();
  const readOnly = isAnalysis || provenanceState !== undefined;
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeStrokeRef = useRef<ActiveStroke | null>(null);
  const currentStateRef = useRef<AnnotationState | null>(null);
  const savedState = answers[identifier]?.answer?.[RESPONSE_ID];
  const initialState = { annotationEvents: isAnnotationEvents(savedState) ? savedState : [] };
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
      answers: { [RESPONSE_ID]: nextState.annotationEvents },
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

    const backdrop = backdropRef.current;
    if (backdrop) {
      backdrop.style.left = canvas.style.left;
      backdrop.style.top = canvas.style.top;
      backdrop.style.width = canvas.style.width;
      backdrop.style.height = canvas.style.height;
      backdrop.style.visibility = 'visible';
    }

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
    const { annotationEvents } = visibleState;
    const strokes = getVisibleDrawIndices(annotationEvents).map((index) => (annotationEvents[index] as DrawEvent)[2].points);
    if (activeStrokeRef.current) strokes.push(activeStrokeRef.current.points);
    renderCanvas(canvas, strokes, pixelRatio, imageRect);
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

  // Pointer events can batch several samples per frame; use them all so fast marks keep their shape and timing.
  const getPoints = (event: React.PointerEvent<HTMLCanvasElement>, allowOutside = true): AnnotationPoint[] => {
    const image = imageRef.current;
    if (!image) return [];
    const canvasBounds = event.currentTarget.getBoundingClientRect();
    const imageBounds = image.getBoundingClientRect();
    const samples = event.nativeEvent.getCoalescedEvents?.() ?? [];
    // Sample timeStamps are on the performance clock; anchor them to Date.now(), the clock windowEvents use.
    const clockOffset = Date.now() - performance.now();
    return (samples.length ? samples : [event.nativeEvent]).flatMap((sample) => {
      const inside = sample.clientX >= canvasBounds.left && sample.clientX <= canvasBounds.right
        && sample.clientY >= canvasBounds.top && sample.clientY <= canvasBounds.bottom;
      if (!allowOutside && !inside) return [];
      // Keep the mark inside the drawable area (graph plus margin).
      const clientX = Math.min(canvasBounds.right, Math.max(canvasBounds.left, sample.clientX));
      const clientY = Math.min(canvasBounds.bottom, Math.max(canvasBounds.top, sample.clientY));
      return [[
        Math.round(clockOffset + sample.timeStamp),
        roundCoordinate((clientX - imageBounds.left) / imageBounds.width),
        roundCoordinate((clientY - imageBounds.top) / imageBounds.height),
      ] as AnnotationPoint];
    });
  };

  const getEvents = () => currentStateRef.current?.annotationEvents ?? [];

  const finishStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const activeStroke = activeStrokeRef.current;
    if (!activeStroke) return;

    activeStroke.points.push(...getPoints(event));
    activeStrokeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const { start, image, points } = activeStroke;
    const drawEvent: DrawEvent = [start, 'draw', { end: points[points.length - 1][0], image, points }];
    publishState({ annotationEvents: [...getEvents(), drawEvent] }, 'Draw stroke');
  };

  const undo = () => {
    const events = getEvents();
    const visible = getVisibleDrawIndices(events);
    if (!visible.length) return;
    publishState({ annotationEvents: [...events, [Date.now(), 'undo', visible[visible.length - 1]]] }, 'Undo stroke');
  };

  const clear = () => {
    const events = getEvents();
    const visible = getVisibleDrawIndices(events);
    if (!visible.length) return;
    publishState({ annotationEvents: [...events, [Date.now(), 'clear', visible]] }, 'Clear annotations');
  };

  const hasStrokes = getVisibleDrawIndices(visibleState.annotationEvents).length > 0;
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
        <div ref={backdropRef} className="annotation-backdrop" aria-hidden="true" />
        <img ref={imageRef} src={parameters.imageUrl} alt={parameters.altText || 'VLAT graph stimulus'} draggable={false} onLoad={redraw} />
        <canvas
          ref={canvasRef}
          className="annotation-layer"
          aria-label="Draw annotations over the graph"
          role="application"
          style={{ touchAction: canEdit ? 'none' : 'auto' }}
          onPointerDown={(event) => {
            if (!canEdit || (event.pointerType === 'mouse' && event.button !== 0)) return;
            const points = getPoints(event, false);
            const image = imageRef.current?.getBoundingClientRect();
            if (!points.length || !image) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            activeStrokeRef.current = {
              start: points[0][0],
              end: points[0][0],
              image: [image.left, image.top, image.width, image.height].map(roundPx) as DrawEvent[2]['image'],
              points,
            };
            redraw();
          }}
          onPointerMove={(event) => {
            if (!canEdit || !activeStrokeRef.current) return;
            activeStrokeRef.current.points.push(...getPoints(event));
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
