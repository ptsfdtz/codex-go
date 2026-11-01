import { t, useLocale } from '../i18n';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
const InstallContext = createContext<{
  standalone: boolean;
  added: boolean;
  prompt?: InstallPrompt;
  install: () => Promise<void>;
}>({ standalone: false, added: false, install: async () => {} });

export function InstallProvider({ children }: { children: ReactNode }) {
  useLocale();
  const [standalone, setStandalone] = useState(false);
  const [added, setAdded] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt>();
  useEffect(() => {
    const media = matchMedia('(display-mode: standalone), (display-mode: fullscreen)');
    const update = () =>
      setStandalone(
        media.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
      );
    const available = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const installed = () => {
      setPrompt(undefined);
      setAdded(true);
    };
    update();
    media.addEventListener('change', update);
    window.addEventListener('beforeinstallprompt', available);
    window.addEventListener('appinstalled', installed);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('beforeinstallprompt', available);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);
  const install = async () => {
    if (!prompt) return;
    setPrompt(undefined);
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      // The browser menu remains available if a native prompt is dismissed/unavailable.
    }
  };
  return (
    <InstallContext.Provider value={{ standalone, added, prompt, install }}>
      {children}
    </InstallContext.Provider>
  );
}

export function InstallApp() {
  useLocale();
  const { standalone, added, prompt, install } = useContext(InstallContext);
  if (standalone) return null;
  return (
    <div className="pwa-install">
      {added ? (
        <p role="status">{t('已添加到主屏幕，请从 AgentDeck 图标打开。')}</p>
      ) : (
        <>
          {prompt && (
            <button type="button" onClick={() => void install()}>
              <Download size={17} />
              {t('安装 AgentDeck')}
            </button>
          )}
          <details>
            <summary>{t('添加到主屏幕')}</summary>
            <ul>
              <li>{t('Android：在浏览器菜单中选择“安装应用”或“添加到主屏幕”。')}</li>
              <li>
                {t(
                  'iPhone / iPad：在 Safari 中点“分享”→“添加到主屏幕”；若有“作为网页 App 打开”，请开启。',
                )}
              </li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
