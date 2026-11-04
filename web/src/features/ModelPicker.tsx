import { positionPopover, useMenuPopover } from '../components/popover';
import { t, useLocale } from '../i18n';
import { useId, useState } from 'react';
import { Check, ChevronDown, RotateCcw, Gauge } from 'lucide-react';
import type { Draft, Model } from '../workspace';
import { resolveComposerModelPreferences } from './composer-preferences';
import { Collapse } from '../motion';

const effortLabel = (value: string) =>
  ({
    none: t('None'),
    minimal: t('Minimal'),
    low: t('Low'),
    medium: t('Medium'),
    high: t('High'),
    xhigh: t('Extra high'),
    max: t('Max'),
    ultra: t('Ultra'),
  })[value] || value;
const modelLabel = (model?: Model) =>
  (model?.displayName || model?.name || model?.id || model?.model || t('Default')).replace(
    /^GPT-/i,
    '',
  );

export function ModelPicker({
  draft,
  models,
  disabled,
  onChange,
  allowDefault = true,
}: {
  draft: Draft;
  models: Model[];
  disabled: boolean;
  onChange: (change: Partial<Draft>) => void;
  allowDefault?: boolean;
}) {
  useLocale();
  const id = useId();
  const popup = useMenuPopover();
  const [modelExpanded, setModelExpanded] = useState(false);
  const model =
    models.find((m) => m.model === draft.model || m.id === draft.model) ||
    (!draft.model ? models.find((m) => m.isDefault) : undefined);
  const efforts =
    model?.supportedReasoningEfforts?.map((e) => (typeof e === 'string' ? e : e.reasoningEffort)) ||
    [];
  const effort = draft.effort || model?.defaultReasoningEffort || '';
  const index = Math.max(0, efforts.indexOf(effort));
  function choose(value: string) {
    onChange({ model: value, effort: '' });
    setModelExpanded(false);
  }
  function openPicker(trigger: HTMLButtonElement) {
    setModelExpanded(false);
    if (popup.current) positionPopover(trigger, popup.current, { width: 288, preferAbove: true });
  }
  return (
    <div className="composer-model">
      <button
        type="button"
        className="model-picker-trigger model-name-trigger"
        disabled={disabled}
        popoverTarget={id}
        aria-label={t('切换模型')}
        title={`${modelLabel(model) === t('Default') && draft.model ? draft.model : modelLabel(model)}${effort ? ` · ${effortLabel(effort)}` : ''}`}
        onClick={(event) => openPicker(event.currentTarget)}
      >
        <Gauge className="model-gauge" size={24} aria-hidden="true" />
        <span>
          {model ? modelLabel(model) : draft.model || t('默认模型')}
          {effort ? ` · ${effortLabel(effort)}` : ''}
        </span>
        <ChevronDown size={13} />
      </button>
      <div
        id={id}
        ref={popup}
        popover="auto"
        className={`model-picker-popup${effort === 'ultra' ? ' is-ultra' : ''}`}
        aria-label={t('模型与思维强度')}
      >
        <div className="model-picker-view">
          <button
            type="button"
            className="model-picker-caption model-picker-model-toggle"
            aria-expanded={modelExpanded}
            onClick={() => setModelExpanded((value) => !value)}
          >
            <span>
              {model ? modelLabel(model) : t('默认模型')}
              {effort ? ` ${effortLabel(effort)}` : ''}
            </span>
            <ChevronDown size={14} />
          </button>
          <Collapse open={modelExpanded}>
            <div role="group" aria-label={t('模型')}>
              {allowDefault && (
                <button
                  type="button"
                  className={`model-picker-option ${!draft.model ? 'selected' : ''}`}
                  aria-pressed={!draft.model}
                  disabled={disabled}
                  onClick={() => choose('')}
                >
                  <span>{t('跟随电脑默认模型')}</span>
                  {!draft.model && <Check size={18} />}
                </button>
              )}
              {models.map((m) => {
                const value = m.model || m.id;
                return value ? (
                  <button
                    type="button"
                    key={value}
                    className={`model-picker-option ${draft.model === value ? 'selected' : ''}`}
                    aria-pressed={draft.model === value}
                    disabled={disabled}
                    onClick={() => choose(value)}
                  >
                    <span>{modelLabel(m)}</span>
                    {draft.model === value && <Check size={18} />}
                  </button>
                ) : null;
              })}
            </div>
          </Collapse>

          <div className="effort-picker-heading">
            <strong>
              {t('思维强度 · ')}
              <span>{effort ? effortLabel(effort) : t('默认')}</span>
            </strong>
            <button
              type="button"
              className="icon-button"
              title={t('重置思维强度')}
              aria-label={t('重置思维强度')}
              disabled={disabled || !draft.effort}
              onClick={() => onChange({ effort: '' })}
            >
              <RotateCcw size={17} />
            </button>
          </div>
          {efforts.length > 1 ? (
            <div className="effort-slider">
              <div
                className="effort-fill"
                aria-hidden="true"
                style={{
                  width: `calc(${(index / (efforts.length - 1)) * 100}% + ${27 - (index / (efforts.length - 1)) * 54}px)`,
                }}
              >
                <span className="effort-ultra-glow" />
              </div>
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
                aria-label={t('推理强度')}
                aria-valuetext={effortLabel(efforts[index]!)}
                min={0}
                max={efforts.length - 1}
                step={1}
                value={index}
                disabled={disabled || !(model?.model || model?.id || draft.model)}
                onChange={(event) =>
                  onChange(
                    resolveComposerModelPreferences(
                      { model: draft.model, effort: efforts[Number(event.target.value)]! },
                      models,
                    ),
                  )
                }
              />
            </div>
          ) : (
            <p className="effort-unavailable">
              {efforts.length === 1 ? effortLabel(efforts[0]!) : t('此模型使用默认思维强度')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
