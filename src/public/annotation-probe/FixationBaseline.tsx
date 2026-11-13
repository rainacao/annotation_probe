import {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { useIsAnalysis } from '../../store/hooks/useIsAnalysis';
import { useNextStep } from '../../store/hooks/useNextStep';
import type { StimulusParams } from '../../store/types';
import { TrialControls } from './TrialControls';
import './annotation.css';

interface FixationParameters {
  /** The upcoming graph. It is laid out invisibly so the cross sits where that graph's centre will appear. */
  imageUrl: string;
  /** How long the fixation cross is shown before the study advances automatically. */
  durationMs: number;
}

const RESPONSE_ID = 'baseline';

type CrossPosition = {
  x: number;
  y: number;
};

export default function FixationBaseline({
  parameters, setAnswer,
}: StimulusParams<FixationParameters>) {
  const isAnalysis = useIsAnalysis();
  const { isNextDisabled, goToNextStep } = useNextStep();
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const advancedRef = useRef(false);
  // setAnswer's identity changes across renders; reading it from a ref keeps the baseline timer from restarting.
  const setAnswerRef = useRef(setAnswer);
  setAnswerRef.current = setAnswer;
  const [cross, setCross] = useState<CrossPosition | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [complete, setComplete] = useState(false);

  const measure = useCallback(() => {
    const image = imageRef.current;
    const stage = stageRef.current;
    if (!image || !stage || !image.complete || !image.naturalWidth) return;
    const imageBounds = image.getBoundingClientRect();
    const stageBounds = stage.getBoundingClientRect();
    setCross({
      x: imageBounds.left - stageBounds.left + imageBounds.width / 2,
      y: imageBounds.top - stageBounds.top + imageBounds.height / 2,
    });
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(measure);
    if (stageRef.current) observer.observe(stageRef.current);
    if (imageRef.current) observer.observe(imageRef.current);
    measure();
    return () => observer.disconnect();
  }, [measure]);

  // The baseline period starts once the cross is on screen, not when the page mounts.
  useEffect(() => {
    if (!cross || startedAt !== null || isAnalysis) return;
    setStartedAt(Date.now());
  }, [cross, startedAt, isAnalysis]);

  useEffect(() => {
    if (startedAt === null) return undefined;
    const timeout = window.setTimeout(() => {
      setAnswerRef.current({
        status: true,
        answers: {
          [RESPONSE_ID]: {
            crossShownAt: startedAt,
            crossHiddenAt: Date.now(),
            durationMs: parameters.durationMs,
          },
        },
      });
      setComplete(true);
    }, parameters.durationMs);
    return () => window.clearTimeout(timeout);
  }, [startedAt, parameters.durationMs]);

  useEffect(() => {
    if (!complete || isNextDisabled || advancedRef.current) return;
    advancedRef.current = true;
    goToNextStep();
  }, [complete, isNextDisabled, goToNextStep]);

  return (
    <section className="annotation-trial" aria-label="Fixation baseline">
      {/* Mirrors the trial's controls row so the stage below starts at the same height. */}
      <TrialControls placeholder />
      <div ref={stageRef} className="annotation-image-stage">
        <img ref={imageRef} className="fixation-placeholder" src={parameters.imageUrl} alt="" draggable={false} onLoad={measure} />
        {cross && (
          <div className="fixation-cross" style={{ left: cross.x, top: cross.y }} aria-label="Fixation cross" role="img" />
        )}
      </div>
    </section>
  );
}
