import { t } from './i18n';
export function initializePwa() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const standalone = matchMedia('(display-mode: standalone)');
  // Measure the fixed containing block independently of Safari's cached window
  // metrics. In an installed iOS app even innerHeight/clientHeight can retain
  // the browser toolbar or dismissed keyboard's shorter height.
  const bounds = document.createElement('div');
  bounds.setAttribute('aria-hidden', 'true');
  bounds.style.cssText =
    'position:fixed;inset:0;visibility:hidden;pointer-events:none;contain:strict;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);';
  root.appendChild(bounds);
  const resize = () => {
    // Pinch zoom changes the visual viewport, not the keyboard/layout height.
    if (viewport && viewport.scale !== 1) return;
    const focused = document.activeElement;
    const editing =
      focused instanceof HTMLElement &&
      focused.matches(
        'textarea, input:not([type="checkbox"]):not([type="radio"]), [contenteditable="true"]',
      );
    const windowHeight = bounds.getBoundingClientRect().height || root.clientHeight;
    const keyboard = !!viewport && editing && windowHeight - viewport.height > 120;
    const installed =
      standalone.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const safeTop = parseFloat(getComputedStyle(bounds).paddingTop) || 0;
    const safeBottom = parseFloat(getComputedStyle(bounds).paddingBottom) || 0;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const translucent =
      document
        .querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
        ?.getAttribute('content') === 'black-translucent';
    const screenHeight =
      window.innerWidth > windowHeight
        ? Math.min(screen.width, screen.height)
        : Math.max(screen.width, screen.height);
    const statusBarDeficit = screenHeight - windowHeight;
    const fullHeight =
      installed && ios && translucent && safeTop > 0 && Math.abs(statusBarDeficit - safeTop) <= 2
        ? windowHeight + Math.min(statusBarDeficit, safeBottom)
        : windowHeight;
    root.dataset.keyboard = keyboard ? 'open' : 'closed';
    root.style.setProperty(
      '--app-height',
      keyboard ? `${viewport.height}px` : installed ? `${fullHeight}px` : '100dvh',
    );
    root.style.setProperty('--app-top', keyboard ? `${viewport.offsetTop}px` : '0px');
  };
  resize();
  viewport?.addEventListener('resize', resize);
  // Safari pans the viewport to reveal the caret without necessarily resizing it.
  viewport?.addEventListener('scroll', resize);
  window.addEventListener('resize', resize);
  window.addEventListener('pageshow', resize);
  standalone.addEventListener('change', resize);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) requestAnimationFrame(resize);
  });
  document.addEventListener('focusin', resize);
  document.addEventListener('focusout', () => requestAnimationFrame(resize));

  const media = matchMedia('(prefers-color-scheme: dark)');
  const updateTheme = () => {
    const theme = root.dataset.theme;
    const dark = theme === 'dark' || (theme !== 'light' && media.matches);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#212121' : '#ffffff');
  };
  updateTheme();
  media.addEventListener('change', updateTheme);
  new MutationObserver(updateTheme).observe(root, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
        updateViaCache: 'none',
      })
      .catch(() => console.warn(t('AgentDeck 离线提示未能启用，可继续在线使用。')));
  }
}
