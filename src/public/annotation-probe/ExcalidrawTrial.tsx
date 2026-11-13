import { CaptureUpdateAction, Excalidraw, newElementWith } from '@excalidraw/excalidraw';
// The stylesheet is exposed through package exports rather than a physical file.
// eslint-disable-next-line import/no-unresolved
import '@excalidraw/excalidraw/index.css';
import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import type { SyntheticEvent } from 'react';
import throttle from 'lodash.throttle';
import { useIsAnalysis } from '../../store/hooks/useIsAnalysis';
import { useStudyState } from '../../store/hooks/useStudyState';
import { useCurrentIdentifier } from '../../routes/utils';
import type { StimulusParams } from '../../store/types';
import {
  DRAWING_WIDTHS, DrawingAPI, DrawingChangeHandler, DrawingElement, DrawingScene, DrawingState, DrawingTool, emptyDrawing,
} from '../libraries/drawing/assets/types';
import { drawingProvenance, resumedDrawingHistory } from '../libraries/drawing/assets/provenance';
import { TrialControls } from './TrialControls';
import '../libraries/drawing/assets/drawing.css';
import './annotation.css';

/** [left, top, width, height] in CSS px. */
type Rect = [number, number, number, number];

type MarkTime = {
  /** Epoch ms when the mark first appeared. */
  start: number;
  /** Epoch ms when the mark last gained points. */
  end: number;
  /** Epoch ms when the eraser removed the mark. */
  erasedAt?: number;
};

/**
 * The Excalidraw scene plus what is needed to place it over the graph.
 * Viewport is locked (scroll 0, zoom 1), so element coordinates are CSS px from the stage's top-left.
 */
type TrialScene = DrawingScene & {
  /** Graph image bounds relative to the stage, which the elements were drawn against. */
  image: Rect | null;
  /** Stage bounds in the viewport, to convert to screen px. */
  stage: Rect | null;
  /** Timing per element id; kept for marks later removed by undo or clear. */
  markTimes: Record<string, MarkTime>;
};

interface ExcalidrawTrialParameters {
  imageUrl: string;
  altText?: string;
}

const RESPONSE_ID = 'drawing';
const STROKE_COLOR = '#111111';
const STROKE_WIDTH = DRAWING_WIDTHS.m;
const ANNOTATION_MARGIN_PX = 24;

const roundPx = (value: number) => Math.round(value * 10) / 10;

function emptyTrialScene(): TrialScene {
  const scene = emptyDrawing();
  return {
    ...scene,
    appState: { ...scene.appState, viewBackgroundColor: 'transparent' },
    image: null,
    stage: null,
    markTimes: {},
  };
}

function sameRect(a: Rect | null, b: Rect | null) {
  return !!a && !!b && a.every((value, index) => value === b[index]);
}

/** Moves and scales elements drawn against one graph position onto another, so marks stay on the same part of the graph. */
function fitElements(elements: readonly DrawingElement[], from: Rect | null, to: Rect): readonly DrawingElement[] {
  if (!from || sameRect(from, to) || !from[2]) return elements;
  const scale = to[2] / from[2];
  return elements.map((element) => {
    const updates: Record<string, unknown> = {
      x: to[0] + (element.x - from[0]) * scale,
      y: to[1] + (element.y - from[1]) * scale,
      width: element.width * scale,
      height: element.height * scale,
    };
    if ('points' in element) {
      updates.points = element.points.map(([x, y]) => [x * scale, y * scale]);
    }
    return newElementWith(element, updates as never);
  });
}

function preventNativeEdit(event: SyntheticEvent) {
  event.preventDefault();
  event.stopPropagation();
}

export default function ExcalidrawTrial({
  parameters, answers, provenanceState, setAnswer, useTrrack,
}: StimulusParams<ExcalidrawTrialParameters, DrawingState>) {
  const isAnalysis = useIsAnalysis();
  const readOnly = isAnalysis || provenanceState !== undefined;
  const identifier = useCurrentIdentifier();
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [initialScene] = useState<TrialScene>(() => {
    const saved = answers[identifier]?.answer?.[RESPONSE_ID] as unknown as TrialScene | undefined;
    return saved ?? emptyTrialScene();
  });
  const [definition] = useState(() => drawingProvenance({ initialDrawing: initialScene, initialColor: 'black', initialPenSize: 'm' }));
  const trrack = useTrrack({ registry: definition.registry, initialState: definition.initialState });
  const restoredState = useStudyState({ trrack });
  const [tool, setTool] = useState<DrawingTool>(restoredState.tool as DrawingTool);
  const [history] = useState(() => resumedDrawingHistory(trrack));
  const [, refreshHistory] = useState(0);
  const [api, setApi] = useState<DrawingAPI | null>(null);
  // Excalidraw ignores scene and tool updates until it has mounted, which its first onChange signals.
  const [ready, setReady] = useState(false);
  const [layout, setLayout] = useState<{ image: Rect; stage: Rect } | null>(null);
  const currentScene = useRef<TrialScene>((restoredState.state as TrialScene | null) ?? initialScene);
  const markTimes = useRef<Record<string, MarkTime>>(structuredClone(currentScene.current.markTimes ?? {}));
  const pointCounts = useRef(new Map<string, number>());
  const restoring = useRef(false);
  const lastElements = useRef('');

  // setAnswer's identity changes across renders; a stable callback keeps the effects below from re-running mid-stroke.
  const setAnswerRef = useRef(setAnswer);
  setAnswerRef.current = setAnswer;

  const publishAnswer = useCallback((scene: TrialScene) => {
    if (readOnly) return;
    // Excalidraw types contain optional undefined fields; strip them before publishing as a JSON response.
    setAnswerRef.current({ status: true, answers: { [RESPONSE_ID]: JSON.parse(JSON.stringify(scene)) } });
  }, [readOnly]);

  const recordScene = useMemo(() => throttle((scene: TrialScene) => {
    trrack.apply('drawing', definition.actions.scene(scene));
    publishAnswer(scene);
  }, 100), [trrack, definition, publishAnswer]);
  useEffect(() => () => { recordScene.flush(); recordScene.cancel(); }, [recordScene]);

  /** Shows a scene without treating it as participant input. */
  const showScene = useCallback((scene: TrialScene) => {
    if (!api || !ready) return;
    restoring.current = true;
    api.updateScene({
      elements: structuredClone(scene.elements),
      appState: {
        ...scene.appState, scrollX: 0, scrollY: 0, selectedElementIds: {},
      },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    scene.elements.forEach((element) => {
      if ('points' in element) pointCounts.current.set(element.id, element.points.length);
    });
    lastElements.current = JSON.stringify(scene.elements);
    requestAnimationFrame(() => { restoring.current = false; });
  }, [api, ready]);

  const placeOnLayout = useCallback((scene: TrialScene): TrialScene => {
    if (!layout) return scene;
    return {
      ...scene,
      elements: fitElements(scene.elements, scene.image, layout.image),
      image: layout.image,
      stage: layout.stage,
      // The study store freezes what it is given, so only copies leave this component.
      markTimes: readOnly ? scene.markTimes : structuredClone(markTimes.current),
    };
  }, [layout, readOnly]);

  const measure = useCallback(() => {
    const image = imageRef.current;
    const stage = stageRef.current;
    if (!image || !stage || !image.complete || !image.naturalWidth) return;
    const imageBounds = image.getBoundingClientRect();
    const stageBounds = stage.getBoundingClientRect();
    const imageRect: Rect = [
      imageBounds.left - stageBounds.left, imageBounds.top - stageBounds.top, imageBounds.width, imageBounds.height,
    ].map(roundPx) as Rect;
    const stageRect: Rect = [stageBounds.left, stageBounds.top, stageBounds.width, stageBounds.height].map(roundPx) as Rect;

    const backdrop = backdropRef.current;
    if (backdrop) {
      const left = Math.max(0, imageRect[0] - ANNOTATION_MARGIN_PX);
      const top = Math.max(0, imageRect[1] - ANNOTATION_MARGIN_PX);
      backdrop.style.left = `${left}px`;
      backdrop.style.top = `${top}px`;
      backdrop.style.width = `${Math.min(stageBounds.width, imageRect[0] + imageRect[2] + ANNOTATION_MARGIN_PX) - left}px`;
      backdrop.style.height = `${Math.min(stageBounds.height, imageRect[1] + imageRect[3] + ANNOTATION_MARGIN_PX) - top}px`;
      backdrop.style.visibility = 'visible';
    }
    setLayout((previous) => (
      previous && sameRect(previous.image, imageRect) && sameRect(previous.stage, stageRect)
        ? previous
        : { image: imageRect, stage: stageRect }));
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(measure);
    if (stageRef.current) observer.observe(stageRef.current);
    if (imageRef.current) observer.observe(imageRef.current);
    measure();
    return () => observer.disconnect();
  }, [measure]);

  // Participant view: keep marks registered to the graph when the layout first settles or changes (resize, rotation).
  useEffect(() => {
    if (readOnly || !api || !ready || !layout) return;
    const scene = currentScene.current;
    const placed = placeOnLayout(scene);
    showScene(placed);
    currentScene.current = placed;
    if (!sameRect(scene.image, layout.image)) {
      recordScene.flush();
      trrack.apply('relayout', definition.actions.scene(placed));
      publishAnswer(placed);
    }
  }, [api, ready, layout, readOnly, placeOnLayout, showScene, recordScene, trrack, definition, publishAnswer]);

  // Replay: draw the participant's scene against this screen's graph position.
  useEffect(() => {
    if (!readOnly || !api || !ready || !layout) return;
    const scene = (provenanceState?.state as TrialScene | null | undefined) ?? currentScene.current;
    showScene(placeOnLayout(scene));
  }, [readOnly, api, ready, layout, provenanceState, placeOnLayout, showScene]);

  useEffect(() => {
    if (!api || !ready || readOnly) return;
    api.setActiveTool({ type: tool === 'eraser' ? 'eraser' : 'freedraw' });
    api.updateScene({
      appState: { currentItemStrokeColor: STROKE_COLOR, currentItemStrokeWidth: STROKE_WIDTH },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [api, ready, readOnly, tool]);

  const handleChange: DrawingChangeHandler = (elements, appState, files) => {
    if (!ready) {
      setReady(true);
      return;
    }
    if (readOnly || restoring.current || !layout) return;
    const serialized = JSON.stringify(elements);
    if (serialized === lastElements.current) return;
    lastElements.current = serialized;

    const now = Date.now();
    elements.forEach((element) => {
      const times = markTimes.current[element.id];
      const count = 'points' in element ? element.points.length : 0;
      if (!times) {
        markTimes.current[element.id] = { start: now, end: now };
      } else if (element.isDeleted) {
        times.erasedAt ??= now;
      } else if (count > (pointCounts.current.get(element.id) ?? 0)) {
        times.end = now;
      }
      pointCounts.current.set(element.id, count);
    });
    const scene: TrialScene = {
      format: 'excalidraw',
      elements: structuredClone(elements),
      files: structuredClone(files),
      appState: {
        scrollX: 0, scrollY: 0, zoom: { ...appState.zoom }, viewBackgroundColor: 'transparent',
      },
      image: layout.image,
      stage: layout.stage,
      markTimes: structuredClone(markTimes.current),
    };
    currentScene.current = scene;
    recordScene(scene);
  };

  const commit = () => {
    if (readOnly || !api) return;
    requestAnimationFrame(() => {
      recordScene.flush();
      const scene = currentScene.current;
      history.commit(scene);
      // The last point may arrive after the last throttled update.
      trrack.apply('drawEnd', definition.actions.scene(scene));
      publishAnswer(scene);
      refreshHistory((value) => value + 1);
    });
  };

  const restore = (scene: TrialScene, label: string) => {
    recordScene.flush();
    const placed = placeOnLayout(scene);
    currentScene.current = placed;
    showScene(placed);
    trrack.apply(label, definition.actions.scene(placed));
    publishAnswer(placed);
    refreshHistory((value) => value + 1);
  };

  const changeTool = (next: DrawingTool) => {
    if (readOnly || next === tool) return;
    recordScene.flush();
    setTool(next);
    trrack.apply('Set Tool', definition.actions.tool(next));
  };
  const undo = () => {
    if (readOnly) return;
    recordScene.flush();
    const scene = history.undo();
    if (scene) restore(scene as TrialScene, 'undo');
  };
  const redo = () => {
    if (readOnly) return;
    recordScene.flush();
    const scene = history.redo();
    if (scene) restore(scene as TrialScene, 'redo');
  };
  const clear = () => {
    if (readOnly) return;
    const scene = { ...emptyTrialScene(), image: layout?.image ?? null, stage: layout?.stage ?? null };
    history.commit(scene);
    restore(scene, 'clearing');
  };

  // Keep the view fixed: elements are stored in stage px, so panning or zooming would detach them from the graph.
  const lockViewport = (scrollX: number, scrollY: number, zoom: { value: number }) => {
    if (!api || (scrollX === 0 && scrollY === 0 && zoom.value === 1)) return;
    api.updateScene({
      appState: { scrollX: 0, scrollY: 0, zoom: { value: 1 as DrawingScene['appState']['zoom']['value'] } },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  };

  const displayedTool = (provenanceState?.tool as DrawingTool | undefined) ?? tool;
  const hasMarks = currentScene.current.elements.some((element) => !element.isDeleted);
  return (
    <section
      className="annotation-trial"
      aria-label="Graph annotation task"
      onKeyDownCapture={(event) => {
        if (readOnly) return;
        const key = event.key.toLowerCase();
        if ((event.ctrlKey || event.metaKey) && (key === 'z' || key === 'y')) {
          event.preventDefault(); event.stopPropagation();
          if (key === 'y' || event.shiftKey) redo(); else undo();
        } else if (
          ['escape', 'delete', 'backspace', ' '].includes(key)
          || (!(event.ctrlKey || event.metaKey) && /^[a-z0-9]$/.test(key))
          || ((event.ctrlKey || event.metaKey) && ['a', 'd', 'x', 'v', '=', '-', '0'].includes(key))
        ) {
          // Excalidraw shortcuts would switch tools, select, pan, or zoom outside the study's controls.
          event.preventDefault(); event.stopPropagation();
        }
      }}
    >
      <TrialControls
        disabled={readOnly}
        tool={displayedTool}
        onTool={changeTool}
        onUndo={undo}
        onRedo={redo}
        onClear={clear}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        canClear={hasMarks}
      />
      <div ref={stageRef} className="annotation-image-stage">
        <div ref={backdropRef} className="annotation-backdrop" aria-hidden="true" />
        <img ref={imageRef} src={parameters.imageUrl} alt={parameters.altText || 'VLAT graph stimulus'} draggable={false} onLoad={measure} />
        <div
          className="annotation-layer revisit-drawing-canvas excalidraw-layer"
          data-testid="drawing-canvas"
          onWheelCapture={preventNativeEdit}
          onContextMenuCapture={preventNativeEdit}
          onCutCapture={preventNativeEdit}
          onPasteCapture={preventNativeEdit}
          onDragOverCapture={preventNativeEdit}
          onDropCapture={preventNativeEdit}
          onPointerUpCapture={commit}
          onPointerCancelCapture={commit}
        >
          <Excalidraw
            excalidrawAPI={setApi}
            initialData={{ elements: [], appState: { viewBackgroundColor: 'transparent' } }}
            onChange={handleChange}
            onScrollChange={lockViewport}
            onPaste={() => false}
            viewModeEnabled={readOnly}
            zenModeEnabled
            UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false } }}
          />
        </div>
      </div>
    </section>
  );
}
