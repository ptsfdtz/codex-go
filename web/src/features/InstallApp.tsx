import { t, useLocale } from '../i18n';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Check, Download } from 'lucide-react';
import { IconButton, Modal } from '../ui';
import { MotionPresence } from '../motion';

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
  const [guideOpen, setGuideOpen] = useState(false);
  if (standalone) return null;
  const guide = (
    <ul>
      <li>{t('Android：在浏览器菜单中选择“安装应用”或“添加到主屏幕”。')}</li>
      <li>
        {t('iPhone / iPad：在 Safari 中点“分享”→“添加到主屏幕”；若有“作为网页 App 打开”，请开启。')}
      </li>
      <li>{t('电脑：在浏览器地址栏或菜单中选择“安装 AgentDeck”。')}</li>
    </ul>
  );
  return (
    <>
      <IconButton
        icon={added ? Check : Download}
        label={t('安装 AgentDeck')}
        onClick={() => (prompt && !added ? void install() : setGuideOpen(true))}
      />
      <MotionPresence>
        {guideOpen && (
          <Modal title={t('安装 AgentDeck')} compact onClose={() => setGuideOpen(false)}>
            <div className="pwa-install">
              {added ? (
                <p role="status">{t('已添加到主屏幕，请从 AgentDeck 图标打开。')}</p>
              ) : (
                guide
              )}
            </div>
          </Modal>
        )}
      </MotionPresence>
    </>
  );
}
