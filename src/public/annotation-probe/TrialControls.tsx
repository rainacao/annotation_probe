import type { DrawingTool } from '../libraries/drawing/assets/types';

/**
 * Drawing controls above the graph. FixationBaseline renders an invisible copy so its stage, and so the
 * fixation cross, lines up with where the graph appears on the trial.
 */
export function TrialControls({
  placeholder = false, disabled = false, tool = 'pen', onTool, onUndo, onRedo, onClear,
  canUndo = false, canRedo = false, canClear = false,
}: {
  placeholder?: boolean;
  disabled?: boolean;
  tool?: DrawingTool;
  onTool?: (tool: DrawingTool) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onClear?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  canClear?: boolean;
}) {
  const tabIndex = placeholder ? -1 : undefined;
  return (
    <div
      className={`annotation-controls${placeholder ? ' fixation-placeholder' : ''}`}
      aria-hidden={placeholder || undefined}
    >
      <span>Draw anywhere with your mouse, finger, or stylus.</span>
      <div className="annotation-actions">
        <button type="button" tabIndex={tabIndex} aria-pressed={tool === 'pen'} disabled={disabled} onClick={() => onTool?.('pen')}>Pen</button>
        <button type="button" tabIndex={tabIndex} aria-pressed={tool === 'eraser'} disabled={disabled} onClick={() => onTool?.('eraser')}>Eraser</button>
        <button type="button" tabIndex={tabIndex} disabled={disabled || !canUndo} onClick={onUndo}>Undo</button>
        <button type="button" tabIndex={tabIndex} disabled={disabled || !canRedo} onClick={onRedo}>Redo</button>
        <button type="button" tabIndex={tabIndex} disabled={disabled || !canClear} onClick={onClear}>Clear</button>
      </div>
    </div>
  );
}
