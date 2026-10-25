export function initializePwa() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const standalone = matchMedia('(display-mode: standalone)');
  const resize = () => {
    // Keep pinch zoom available; only keyboard/window resizing changes the shell.
    if (viewport && viewport.scale !== 1) return;
    const focused = document.activeElement;
    const editing =
      focused instanceof HTMLElement &&
      focused.matches(
        'textarea, input:not([type="checkbox"]):not([type="radio"]), [contenteditable="true"]',
      );
    // iOS standalone can report a smaller visual viewport even with no keyboard.
    // Let CSS size the normal window; use the visual viewport only for an overlay keyboard.
    const keyboard = !!viewport && editing && root.clientHeight - viewport.height > 120;
    const installed =
      standalone.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    // Safari can leave dvh shorter than the installed window after dismissing
    // the keyboard. Use the layout window rather than that stale CSS unit.
    const height = installed ? `${Math.max(window.innerHeight, root.clientHeight)}px` : '100dvh';
    root.dataset.keyboard = keyboard ? 'open' : 'closed';
    root.style.setProperty('--app-height', keyboard ? `${viewport.height}px` : height);
    root.style.setProperty('--app-top', keyboard ? `${viewport.offsetTop}px` : '0px');
  };
  resize();
  viewport?.addEventListener('resize', resize);
  // Safari pans the viewport to reveal the caret without necessarily resizing it.
  viewport?.addEventListener('scroll', resize);
  window.addEventListener('resize', resize);
  window.addEventListener('pageshow', resize);
  standalone.addEventListener('change', resize);
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
      .catch(() => console.warn('AgentDeck 离线提示未能启用，可继续在线使用。'));
  }
}
