import { APPLE_SMOOTHING, generatePath } from '@lisse/core/path';

// Restrict masks to painted surfaces. Layout, scrolling regions, floating
// anchors and circular indicators keep their existing geometry.
const surfaces = `
  button, .icon-button, input:not([type='hidden'], [type='file'], [type='range'], [type='radio']),
  textarea, select, summary, progress, pre, code, mark, [popover],
  .composer-suggestions, .task-banner, .composer, .modal, .modal-wide, .popover, .card, .permission-options, .model-picker-models,
  .select-popup, .select-option, .mode-menu, .permission-popup, .sidebar-context-menu,
  .approval, .async-questions, .plan-content, .plan-decision, .plan-decision-checkbox,
  .confirmation, .connection-error, .history-error, .receipt-recovery, .device-delete-confirmation,
  .user-turn > .message-content, .api-message-body, .message-image-placeholder,
  .saved-image img, .attachment-thumbnail, .project-image-preview, .project-overview-thumbnail,
  .composer-attachment, .composer-drop-hint, .composer-speech-status,
  .resource-chip, .goal-status, .queued-message, .queued-messages, .queued-content, .queue-entry,
  .queued-text, .selection-quote,
  .effort-slider, .effort-rail, .effort-fill, .turn-changes, .diff-text, .file-preview,
  .tool-tab, .file-tab, .file-filter, .file-tree-row, .branch-file, .branch-help > div,
  .branch-select-field > div,
  .branch-modes, .branch-modes label > span, .branch-count, .branch-file-filter, .branch-file-status,
  .file-changes-heading small, .file-changes-info, .branch-file-info,
  .sidebar-project-heading, .session-row, .sidebar-session-actions, .desktop-session-row,
  .api-chat-row, .api-provider-row, .host-device-icon, .settings-section, .modal .host,
  .settings-general .setting-row > .select-control, .project-overview-row,
  .project-settings-row, .project-settings-folder, .project-settings-search,
  .project-settings-name small, .project-settings-confirm, .search-highlight
`;

type Surface = { width: number; height: number; key?: string };
type Radii = readonly [number, number, number, number];

function mask(width: number, height: number, content: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${content}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function contourMasks(width: number, height: number, radii: Radii, composer: boolean) {
  const uniform = radii.every((radius) => radius === radii[0]);
  // Use the two halves of Lisse's collapsed capsule for uniform corners.
  // Taller surfaces gain straight sides without changing either half.
  const capHeight = uniform ? Math.min(height, radii[0] * 2) : height;
  const [topLeft, topRight, bottomRight, bottomLeft] = radii.map((radius) => ({
    radius,
    smoothing: APPLE_SMOOTHING,
  }));
  const d = generatePath(width, capHeight, { topLeft, topRight, bottomRight, bottomLeft });
  const shape = `<path id="shape" d="${d}"/>`;
  const inside = '<clipPath id="inside"><use href="#shape"/></clipPath>';
  const fill = '<use href="#shape"/>';
  const stroke =
    '<use href="#shape" fill="none" stroke="black" stroke-width="2" clip-path="url(#inside)"/>';
  const growth = height - capHeight;

  if (!growth) {
    return {
      fill: mask(width, height, `<defs>${shape}</defs>${fill}`),
      rim: composer ? mask(width, height, `<defs>${shape}${inside}</defs>${stroke}`) : undefined,
    };
  }

  const split = capHeight / 2;
  // Overlap the joins by a fraction of a pixel to avoid seams in a raster mask.
  const start = split - 0.25;
  const centerHeight = growth + 0.5;
  const slices = `
    <clipPath id="upper"><rect width="${width}" height="${split + 0.25}"/></clipPath>
    <clipPath id="lower"><rect y="${start}" width="${width}" height="${split + 0.25}"/></clipPath>
  `;
  const draw = (content: string, center: string) =>
    `<defs>${shape}${slices}${inside}</defs>${center}
     <g clip-path="url(#upper)">${content}</g>
     <g transform="translate(0 ${growth})" clip-path="url(#lower)">${content}</g>`;
  const rect = (x: number, rectWidth: number) =>
    `<rect x="${x}" y="${start}" width="${rectWidth}" height="${centerHeight}"/>`;
  return {
    fill: mask(width, height, draw(fill, rect(0, width))),
    rim: composer ? mask(width, height, draw(stroke, rect(0, 1) + rect(width - 1, 1))) : undefined,
  };
}

function cornerRadius(value: string) {
  // CSS percentages here describe the round icons and native indicators.
  // CSS length radii also cover capsules such as 99px, which Lisse clamps.
  return value.endsWith('px') && !value.includes(' ') ? parseFloat(value) : 0;
}

export function initializeContinuousCorners() {
  if (
    !window.ResizeObserver ||
    (!CSS.supports('mask-image', 'url("")') && !CSS.supports('-webkit-mask-image', 'url("")'))
  )
    return;

  // The mobile sheet grip is a fixed 34×4 paint box, not an observed element.
  document.documentElement.style.setProperty(
    '--continuous-sheet-grip',
    contourMasks(34, 4, [2, 2, 2, 2], false).fill,
  );

  const measured = new Map<HTMLElement, Surface>();
  const pending = new Set<HTMLElement>();
  // Many controls share geometry. Keep a bounded cache, never a cache keyed by
  // conversation content or one entry for every transient resize dimension.
  const masksByGeometry = new Map<string, ReturnType<typeof contourMasks>>();
  let frame: number | undefined;

  function schedulePaint(elements: Iterable<HTMLElement>) {
    for (const node of elements) pending.add(node);
    if (!pending.size || frame !== undefined) return;
    // ResizeObserver callbacks only read geometry. Apply masks outside its
    // delivery cycle so WebKit can finish any concurrent editor resize.
    frame = requestAnimationFrame(() => {
      frame = undefined;
      paint(pending);
      pending.clear();
    });
  }

  function paint(elements: Iterable<HTMLElement>) {
    const updates = [];
    for (const node of elements) {
      const surface = measured.get(node);
      if (!surface || !surface.width || !surface.height) continue;
      const style = getComputedStyle(node);
      const composer = node.classList.contains('composer');
      // The composer's paint sits inside its existing 1px border so it cannot
      // expand the scrollable box or clip interactive content.
      const inset = composer ? 2 : 0;
      const width = surface.width - inset;
      const height = surface.height - inset;
      if (width <= 0 || height <= 0) continue;
      const radii: Radii = [
        cornerRadius(style.borderTopLeftRadius),
        cornerRadius(style.borderTopRightRadius),
        cornerRadius(style.borderBottomRightRadius),
        cornerRadius(style.borderBottomLeftRadius),
      ];
      const key = radii.some(Boolean) ? [width, height, composer, ...radii].join('/') : '';
      if (key === surface.key) continue;
      surface.key = key;
      updates.push({ node, width, height, radii, composer, key, rounded: Boolean(key) });
    }

    for (const { node, width, height, radii, composer, key, rounded } of updates) {
      if (!rounded) {
        clear(node);
        continue;
      }
      let masks = masksByGeometry.get(key);
      if (!masks) {
        masks = contourMasks(width, height, radii, composer);
        if (masksByGeometry.size >= 256)
          masksByGeometry.delete(masksByGeometry.keys().next().value!);
        masksByGeometry.set(key, masks);
      }
      node.style.setProperty('--continuous-corner-mask', masks.fill);
      if (masks.rim) node.style.setProperty('--continuous-corner-rim', masks.rim);
      node.setAttribute('data-continuous-corners', '');
    }
  }

  function clear(node: HTMLElement) {
    node.removeAttribute('data-continuous-corners');
    node.style.removeProperty('--continuous-corner-mask');
    node.style.removeProperty('--continuous-corner-rim');
  }

  const resize = new ResizeObserver((entries) => {
    const changed = [];
    for (const { target, borderBoxSize } of entries) {
      const node = target as HTMLElement;
      const surface = measured.get(node);
      if (!surface) continue;
      const box = borderBoxSize?.[0];
      surface.width = box?.inlineSize ?? node.offsetWidth;
      surface.height = box?.blockSize ?? node.offsetHeight;
      changed.push(node);
    }
    schedulePaint(changed);
  });

  function observe(node: HTMLElement) {
    if (measured.has(node)) return;
    measured.set(node, { width: 0, height: 0 });
    resize.observe(node, { box: 'border-box' });
  }

  function forget(node: HTMLElement) {
    if (!measured.delete(node)) return;
    resize.unobserve(node);
    pending.delete(node);
    clear(node);
  }

  function visit(root: Element, visitSurface: (node: HTMLElement) => void) {
    if (root instanceof HTMLElement && root.matches(surfaces)) visitSurface(root);
    for (const node of root.querySelectorAll(surfaces))
      if (node instanceof HTMLElement) visitSurface(node);
  }

  new MutationObserver((records) => {
    const restyled = new Set<HTMLElement>();
    const detached = new Set<HTMLElement>();
    for (const { target, type, addedNodes, removedNodes } of records) {
      if (type === 'attributes' && target instanceof HTMLElement) {
        if (target.matches(surfaces)) {
          observe(target);
          restyled.add(target);
        } else forget(target);
      }
      for (const root of addedNodes)
        if (root instanceof HTMLElement && root.isConnected) visit(root, observe);
      for (const root of removedNodes)
        if (root instanceof HTMLElement && !root.isConnected) detached.add(root);
    }
    // Visit only removed subtrees; replacing one streaming text node must not
    // scan every observed control in a long conversation.
    for (const root of detached) {
      forget(root);
      for (const child of root.querySelectorAll<HTMLElement>('*')) {
        if (!child.isConnected) forget(child);
      }
    }
    schedulePaint(restyled);
  }).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'open', 'data-image'],
  });

  window.addEventListener('resize', () => schedulePaint(measured.keys()), { passive: true });
  visit(document.body, observe);
}
