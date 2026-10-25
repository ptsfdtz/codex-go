import { useId, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import type { Draft, Model } from '../workspace';

const effortLabel = (value: string) =>
  ({
    none: 'None',
    minimal: 'Minimal',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    xhigh: 'Extra high',
    max: 'Max',
    ultra: 'Ultra',
  })[value] || value;
const modelLabel = (model?: Model) =>
  (model?.displayName || model?.name || model?.id || model?.model || 'Default').replace(
    /^GPT-/i,
    '',
  );

export function ModelPicker({
  draft,
  models,
  disabled,
  onChange,
}: {
  draft: Draft;
  models: Model[];
  disabled: boolean;
  onChange: (change: Partial<Draft>) => void;
}) {
  const id = useId();
  const popup = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<'effort' | 'models'>('effort');
  const model =
    models.find((m) => (m.id || m.model) === draft.model) ||
    (!draft.model ? models.find((m) => m.isDefault) : undefined);
  const efforts =
    model?.supportedReasoningEfforts?.map((e) => (typeof e === 'string' ? e : e.reasoningEffort)) ||
    [];
  const effort = draft.effort || model?.defaultReasoningEffort || '';
  const index = Math.max(0, efforts.indexOf(effort));
  function choose(value: string) {
    onChange({ model: value, effort: '' });
    setView('effort');
  }
  function openPicker(trigger: HTMLButtonElement, next: 'effort' | 'models') {
    const box = trigger.getBoundingClientRect();
    const node = popup.current;
    if (node) {
      node.style.left = `${Math.max(12, Math.min(box.left, window.innerWidth - 300))}px`;
      node.style.bottom = `${window.innerHeight - box.top + 10}px`;
      node.style.maxHeight = `${Math.max(120, box.top - 24)}px`;
    }
    setView(next);
  }
  return (
    <div className="composer-model">
      <button
        className="model-picker-trigger model-name-trigger"
        disabled={disabled}
        popoverTarget={id}
        aria-label="切换模型"
        title={modelLabel(model) === 'Default' && draft.model ? draft.model : modelLabel(model)}
        onClick={(event) => openPicker(event.currentTarget, 'models')}
      >
        <span>{model ? modelLabel(model) : draft.model || 'Default'}</span>
        <ChevronDown size={13} />
      </button>
      <button
        className="model-picker-trigger"
        disabled={disabled}
        popoverTarget={id}
        aria-label="模型与思维强度"
        onClick={(event) => openPicker(event.currentTarget, 'effort')}
      >
        <span>{effort ? effortLabel(effort) : 'Default'}</span>
        <ChevronDown size={13} />
      </button>
      <div
        id={id}
        ref={popup}
        popover="auto"
        className="model-picker-popup"
        aria-label="模型与思维强度"
      >
        <div className="model-picker-view" key={view}>
          {view === 'models' ? (
            <>
              <div className="model-picker-caption">Select model</div>
              <div role="group" aria-label="模型">
                <button
                  className={`model-picker-option ${!draft.model ? 'selected' : ''}`}
                  disabled={disabled}
                  onClick={() => choose('')}
                >
                  <span>
                    Default<small>Recommended set of models</small>
                  </span>
                  {!draft.model && <Check size={18} />}
                </button>
                {models.map((m) => {
                  const value = m.id || m.model;
                  return value ? (
                    <button
                      key={value}
                      className={`model-picker-option ${draft.model === value ? 'selected' : ''}`}
                      disabled={disabled}
                      onClick={() => choose(value)}
                    >
                      <span>{modelLabel(m)}</span>
                      {draft.model === value && <Check size={18} />}
                    </button>
                  ) : null;
                })}
              </div>
            </>
          ) : (
            <>
              <div className="effort-picker-heading">
                <strong>{effort ? effortLabel(effort) : 'Default'}</strong>
                <button
                  className="icon-button"
                  title="重置思维强度"
                  aria-label="重置思维强度"
                  disabled={disabled || !draft.effort}
                  onClick={() => onChange({ effort: '' })}
                >
                  <RotateCcw size={17} />
                </button>
              </div>
              <button
                className="effort-model-link"
                aria-label="选择模型"
                onClick={() => setView('models')}
              >
                {modelLabel(model)}
                <ChevronRight size={13} />
              </button>
              {efforts.length > 1 ? (
                <div className="effort-slider">
                  <div
                    className="effort-fill"
                    aria-hidden="true"
                    style={{ transform: `scaleX(${index / (efforts.length - 1)})` }}
                  />
                  <div className="effort-ticks" aria-hidden="true">
                    {efforts.map((e) => (
                      <i key={e} />
                    ))}
                  </div>
                  <div className="effort-thumb-track" aria-hidden="true">
                    <div
                      className="effort-thumb"
                      style={{ transform: `translateX(${(index / (efforts.length - 1)) * 100}%)` }}
                    />
                  </div>
                  <input
                    type="range"
                    aria-label="推理强度"
                    aria-valuetext={effortLabel(efforts[index]!)}
                    min={0}
                    max={efforts.length - 1}
                    step={1}
                    value={index}
                    disabled={disabled}
                    onChange={(event) => onChange({ effort: efforts[Number(event.target.value)] })}
                  />
                </div>
              ) : (
                <p className="effort-unavailable">
                  {efforts.length === 1 ? effortLabel(efforts[0]!) : '此模型使用默认思维强度'}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
