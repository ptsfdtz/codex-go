export function initializePwa() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const resize = () => {
    // Keep pinch zoom available; only keyboard/window resizing changes the shell.
    if (viewport && viewport.scale !== 1) return;
    root.style.setProperty('--app-height', `${viewport?.height ?? window.innerHeight}px`);
  };
  resize();
  viewport?.addEventListener('resize', resize);
  window.addEventListener('resize', resize);

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
