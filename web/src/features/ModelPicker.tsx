import { positionPopover, useMenuPopover } from '../components/popover';
import { t, useLocale } from '../i18n';
import { useId, useState } from 'react';
import { Check, ChevronDown, ChevronRight, RotateCcw, Zap } from 'lucide-react';
import { IconButton } from '../ui';
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
  (model?.displayName || model?.name || model?.id || model?.model || t('Default'))
    .replace(/^GPT-/i, '')
    .replace(/(\d)-(?=[A-Za-z])/g, '$1 ');

function positionModelPicker(trigger: HTMLButtonElement, panel: HTMLElement) {
  const mobile = matchMedia('(max-width: 760px)').matches;
  positionPopover(trigger, panel, {
    width: mobile ? 320 : 288,
    preferAbove: true,
    align: mobile ? 'center' : 'start',
  });
  if (mobile && trigger.closest('.shell .composer-toolbar')) {
    const viewport = window.visualViewport;
    const height = viewport?.height ?? window.innerHeight;
    const inset = Math.max(0, window.innerHeight - height - (viewport?.offsetTop ?? 0));
    panel.style.top = 'auto';
    panel.style.bottom = `calc(${inset + 4}px + var(--app-safe-bottom))`;
    panel.style.maxHeight = `calc(${Math.max(0, height - 16)}px - var(--app-safe-top) - var(--app-safe-bottom))`;
  }
}

export function ModelPicker({
  draft,
  models,
  disabled,
  onChange,
  allowDefault = true,
  allowResponseSpeed = false,
  onOpenChange,
}: {
  draft: Draft;
  models: Model[];
  disabled: boolean;
  onChange: (change: Partial<Draft>) => void;
  allowDefault?: boolean;
  allowResponseSpeed?: boolean;
  onOpenChange?: (open: boolean, panel: HTMLDivElement) => void;
}) {
  useLocale();
  const id = useId();
  const popup = useMenuPopover(positionModelPicker);
  const [modelExpanded, setModelExpanded] = useState(false);
  const [keyboardSlider, setKeyboardSlider] = useState(false);
  const model =
    models.find((m) => m.model === draft.model || m.id === draft.model) ||
    (!draft.model ? models.find((m) => m.isDefault) : undefined);
  const efforts =
    model?.supportedReasoningEfforts?.map((e) => (typeof e === 'string' ? e : e.reasoningEffort)) ||
    [];
  const effort = draft.effort || model?.defaultReasoningEffort || '';
  const index = Math.max(0, efforts.indexOf(effort));
  const progress = efforts.length > 1 ? index / (efforts.length - 1) : 0.5;
  const defaultIndex = efforts.indexOf(model?.defaultReasoningEffort || '');
  let dialProgress = progress;
  if (defaultIndex > 0 && defaultIndex < efforts.length - 1) {
    dialProgress =
      index <= defaultIndex
        ? index / (2 * defaultIndex)
        : 0.5 + (index - defaultIndex) / (2 * (efforts.length - 1 - defaultIndex));
  }
  const showSpeed = allowResponseSpeed && !!model?.fastServiceTier;
  const fast = showSpeed && draft.responseSpeed === 'fast';
  const name = model ? modelLabel(model) : draft.model || t('默认模型');
  const label = `${name}${effort ? ` · ${effortLabel(effort)}` : ''}${fast ? ` · ${t('快速模式')}` : ''}`;
  function enableFast() {
    onChange({ responseSpeed: 'fast', model: model?.model || model?.id });
  }
  function choose(value: string) {
    onChange({ model: value, effort: '', responseSpeed: undefined });
    setModelExpanded(false);
  }
  function openPicker(trigger: HTMLButtonElement) {
    setModelExpanded(false);
    if (popup.current) positionModelPicker(trigger, popup.current);
  }
  return (
    <div className="composer-model">
      {showSpeed && (
        <button
          type="button"
          className="icon-button model-fast-toggle"
          aria-label={t('快速模式')}
          aria-pressed={fast}
          title={t('快速模式')}
          disabled={disabled}
          onClick={() => {
            if (fast) onChange({ responseSpeed: 'default' });
            else enableFast();
          }}
        >
          <Zap size={22} fill="currentColor" aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        className="model-picker-trigger model-name-trigger"
        disabled={disabled}
        popoverTarget={id}
        aria-label={t('切换模型')}
        aria-description={label}
        title={label}
        onClick={(event) => openPicker(event.currentTarget)}
      >
        <svg
          className="model-gauge"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path className="model-gauge-track" d="M5.64 19.36a9 9 0 1 1 12.72 0" />
          <path
            className="model-gauge-fill"
            d="M5.64 19.36a9 9 0 1 1 12.72 0"
            pathLength="1"
            strokeDasharray={`${0.07 + dialProgress * 0.86} 1`}
          />
          <path
            className="model-gauge-needle"
            data-keyboard={keyboardSlider}
            d="M12 11V6.5"
            style={{ transform: `rotate(${(dialProgress - 0.5) * 224}deg)` }}
          />
          <circle className="model-gauge-hub" cx="12" cy="13" r="2" />
        </svg>
        <span>{label}</span>
        <ChevronDown size={13} />
      </button>
      <div
        id={id}
        ref={popup}
        popover="auto"
        className="model-picker-popup"
        aria-label={t('模型与思维强度')}
        onToggle={(event) =>
          onOpenChange?.(event.currentTarget.matches(':popover-open'), event.currentTarget)
        }
      >
        <div className="model-picker-view">
          <button
            type="button"
            className="model-picker-model-toggle"
            aria-expanded={modelExpanded}
            onClick={() => setModelExpanded((value) => !value)}
          >
            <span>{name}</span>
            {effort && <small>{effortLabel(effort)}</small>}
            <ChevronRight size={15} aria-hidden="true" />
          </button>
          <Collapse open={modelExpanded}>
            <div className="model-picker-models" role="group" aria-label={t('模型')}>
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
              <button
                type="button"
                className="model-picker-option model-picker-mobile-reset"
                disabled={disabled || !draft.effort}
                onClick={() => onChange({ effort: '' })}
              >
                <span>{t('重置思维强度')}</span>
                <RotateCcw size={17} aria-hidden="true" />
              </button>
            </div>
          </Collapse>

          {(efforts.length > 1 || draft.effort) && (
            <div className="model-effort">
              {efforts.length > 1 ? (
                <div className="effort-slider">
                  <div className="effort-rail" aria-hidden="true">
                    <div
                      className="effort-fill"
                      style={{
                        width: `calc(${progress} * (100% - var(--effort-fill-start)) + var(--effort-fill-start))`,
                      }}
                    />
                  </div>
                  <div className="effort-ticks" aria-hidden="true">
                    {efforts.map((e) => (
                      <i key={e} />
                    ))}
                  </div>
                  <div className="effort-thumb-track" aria-hidden="true">
                    <div
                      className="effort-thumb"
                      style={{ transform: `translateX(${progress * 100}%)` }}
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
                    onKeyDown={() => setKeyboardSlider(true)}
                    onPointerDown={() => setKeyboardSlider(false)}
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
                <span className="effort-unavailable">{t('推理强度')}</span>
              )}
              <IconButton
                icon={RotateCcw}
                className="model-picker-desktop-reset"
                label={t('重置思维强度')}
                disabled={disabled || !draft.effort}
                onClick={() => onChange({ effort: '' })}
              />
            </div>
          )}
          {!efforts.length && !effort && (
            <p className="effort-unavailable">{t('此模型使用默认思维强度')}</p>
          )}
          {showSpeed && (
            <div className="model-speed" role="group" aria-label={t('响应速度')}>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={draft.responseSpeed === undefined}
                onClick={() => onChange({ responseSpeed: undefined })}
              >
                {t('跟随会话')}
              </button>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={draft.responseSpeed === 'default'}
                onClick={() => onChange({ responseSpeed: 'default' })}
              >
                {t('标准模式')}
              </button>
              <button type="button" disabled={disabled} aria-pressed={fast} onClick={enableFast}>
                <Zap size={14} aria-hidden="true" />
                {t('快速模式')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
