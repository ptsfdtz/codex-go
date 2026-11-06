import { t, useLocale } from '../i18n';
import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import './select.css';

type Option = { value: string; label: string; disabled: boolean; group?: string };
function text(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child) ? text(child.props.children) : String(child),
    )
    .join('');
}
function optionsFrom(children: ReactNode, group?: string, disabled = false): Option[] {
  return Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{ children?: ReactNode; value?: string; label?: string; disabled?: boolean }>(
        child,
      )
    )
      return [];
    if (child.type === Fragment) return optionsFrom(child.props.children, group, disabled);
    if (child.type === 'optgroup')
      return optionsFrom(child.props.children, child.props.label, disabled || child.props.disabled);
    if (child.type !== 'option') return [];
    return [
      {
        value: String(child.props.value ?? text(child.props.children)),
        label: child.props.label ?? text(child.props.children),
        disabled: disabled || !!child.props.disabled,
        group,
      },
    ];
  });
}

/** Select-only combobox with a top-layer list; independent of native picker styling. */
export function Select({
  value,
  onValueChange,
  children,
  disabled = false,
  name,
  id,
  title,
  className = '',
  triggerIcon,
  'aria-label': label,
  'aria-labelledby': labelledBy,
}: {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  disabled?: boolean;
  name?: string;
  id?: string;
  title?: string;
  className?: string;
  triggerIcon?: ReactNode;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}) {
  useLocale();
  const uid = useId();
  const popupId = `${uid}-popup`,
    listId = `${uid}-list`;
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState('');
  const typing = useRef({ value: '', time: 0 });
  const options = optionsFrom(children);
  const current = options.find((option) => option.value === value);
  const searchable = options.length >= 8;
  const visible = options.filter((option) =>
    `${option.group || ''} ${option.label}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const enabled = visible.filter((option) => !option.disabled);
  const activeOption = enabled.find((option) => option.value === active) || enabled[0];
  const optionId = (option: Option) => `${uid}-option-${options.indexOf(option)}`;

  function close(restore = false) {
    popup.current?.hidePopover();
    setOpen(false);
    if (restore) trigger.current?.focus({ preventScroll: true });
  }
  function choose(option: Option) {
    if (disabled || option.disabled) return;
    close(true);
    if (option.value !== value) onValueChange(option.value);
  }
  function position() {
    const node = popup.current,
      button = trigger.current;
    if (!node || !button) return;
    const rect = button.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0,
      top = viewport?.offsetTop || 0;
    const width = viewport?.width || window.innerWidth,
      height = viewport?.height || window.innerHeight;
    const below = top + height - rect.bottom - 16,
      above = rect.top - top - 16;
    const up = below < Math.min(280, options.length * 40 + (searchable ? 54 : 12)) && above > below;
    const panelWidth = Math.min(Math.max(rect.width, searchable ? 300 : 220), width - 24);
    node.style.width = `${panelWidth}px`;
    node.style.left = `${Math.max(left + 12, Math.min(rect.left, left + width - panelWidth - 12))}px`;
    node.style.top = up ? 'auto' : `${rect.bottom + 6}px`;
    node.style.bottom = up ? `${window.innerHeight - rect.top + 6}px` : 'auto';
    node.style.maxHeight = `${Math.max(60, Math.min(360, up ? above : below))}px`;
    node.style.transformOrigin = up ? 'bottom left' : 'top left';
  }
  function show(last = false) {
    if (disabled) return;
    setQuery('');
    setActive(
      (last
        ? options.filter((option) => !option.disabled).at(-1)
        : options.find((o) => o.value === value && !o.disabled) || options.find((o) => !o.disabled)
      )?.value || '',
    );
    position();
    if (!popup.current?.matches(':popover-open')) popup.current?.showPopover();
    setOpen(true);
  }
  useLayoutEffect(() => {
    if (!open) return;
    position();
    popup.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  });
  useEffect(() => {
    if (disabled && open) close();
  }, [disabled, open]);
  useEffect(() => {
    if (!open) return;
    const update = () => position();
    const scroll = (event: Event) => {
      if (event.target instanceof Node && popup.current?.contains(event.target)) return;
      close();
    };
    const blur = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !popup.current?.contains(event.target) &&
        event.target !== trigger.current
      )
        close();
    };
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    document.addEventListener('scroll', scroll, true);
    document.addEventListener('focusin', blur);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      document.removeEventListener('scroll', scroll, true);
      document.removeEventListener('focusin', blur);
    };
  });
  function keydown(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      if (open && searchable && event.target === trigger.current && !event.shiftKey) {
        event.preventDefault();
        search.current?.focus();
        return;
      }
      if (open && event.target === search.current && event.shiftKey) {
        event.preventDefault();
        trigger.current?.focus();
        return;
      }
      if (event.target === search.current) trigger.current?.focus();
      close();
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      // Home/End in the search field retain normal text editing.
      if (event.target === search.current && ['Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      if (!open) {
        show(event.key === 'End' || event.key === 'ArrowUp');
        return;
      }
      const i = enabled.findIndex((option) => option.value === activeOption?.value);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? enabled.length - 1
            : (i + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
      setActive(enabled[next]?.value || '');
      return;
    }
    if (event.key === 'Enter' || (event.key === ' ' && event.target !== search.current)) {
      event.preventDefault();
      if (!open) show();
      else if (activeOption) choose(activeOption);
      return;
    }
    if (
      event.target === search.current ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.key.length !== 1
    )
      return;
    event.preventDefault();
    if (!open) show();
    const now = Date.now();
    typing.current.value =
      now - typing.current.time < 700 ? typing.current.value + event.key : event.key;
    typing.current.time = now;
    const found = options.find(
      (option) =>
        !option.disabled &&
        option.label.toLocaleLowerCase().startsWith(typing.current.value.toLocaleLowerCase()),
    );
    if (found) setActive(found.value);
  }
  return (
    <div className={`select-control ${className}`}>
      {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        className={`select-trigger${triggerIcon ? ' select-trigger-icon' : ''}`}
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && activeOption ? optionId(activeOption) : undefined}
        disabled={disabled}
        title={title || current?.label}
        onKeyDown={keydown}
        onClick={() => (open ? close(true) : show())}
      >
        {triggerIcon || (
          <>
            <span>{current?.label || value || t('请选择')}</span>
            <ChevronDown size={15} aria-hidden="true" />
          </>
        )}
      </button>
      <div
        id={popupId}
        ref={popup}
        popover="auto"
        className="select-popup"
        onKeyDown={keydown}
        onToggle={(event) => {
          const isOpen = event.newState === 'open';
          setOpen(isOpen);
          if (!isOpen) setQuery('');
        }}
      >
        {searchable && (
          <div className="select-search">
            <Search size={15} aria-hidden="true" />
            <input
              ref={search}
              type="search"
              placeholder={t('搜索选项…')}
              aria-label={t('搜索{{p0}}', { p0: label || t('选项') })}
              aria-controls={listId}
              aria-activedescendant={open && activeOption ? optionId(activeOption) : undefined}
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive('');
              }}
            />
          </div>
        )}
        <div
          id={listId}
          role="listbox"
          aria-label={label}
          aria-labelledby={labelledBy}
          className="select-options"
        >
          {visible.map((option, index) => (
            <Fragment key={option.value}>
              {option.group && (index === 0 || visible[index - 1]?.group !== option.group) && (
                <div className="select-group" role="presentation">
                  {option.group}
                </div>
              )}
              <div
                id={optionId(option)}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                data-active={activeOption?.value === option.value}
                className="select-option"
                title={option.label}
                onPointerMove={(event) => {
                  if (event.pointerType === 'mouse' && !option.disabled) setActive(option.value);
                }}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => {
                  event.preventDefault();
                  choose(option);
                }}
              >
                <span>{option.label}</span>
                <Check size={15} aria-hidden="true" className="select-check" />
              </div>
            </Fragment>
          ))}
          {!visible.length && (
            <p className="select-empty" role="status">
              {t('没有匹配的选项')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
