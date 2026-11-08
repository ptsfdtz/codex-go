import { errorText, t, useLocale } from '../../i18n';
import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { Request } from '../../workspace';
import '@xterm/xterm/css/xterm.css';

type Output = { data: string; offset: number; truncated: boolean; eof: boolean };
export function SshTerminal({
  request,
  visible,
  connected,
  projectId,
}: {
  request: Request;
  visible: boolean;
  connected: boolean;
  projectId: string;
}) {
  useLocale();
  const [generation, setGeneration] = useState(0);
  const [active, setActive] = useState(connected);
  const [phase, setPhase] = useState('connecting');
  const [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal>(undefined);
  const fit = useRef<FitAddon>(undefined);
  const send = useRef<(data: string) => void>(() => undefined);
  useEffect(() => {
    if (!connected) {
      setActive(false);
      setPhase('closed');
      return;
    }
    if (!active || !container.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      scrollback: 3000,
      theme: { background: '#171717', foreground: '#e7e7e7', cursor: '#e7e7e7' },
      allowProposedApi: false,
    });
    const addon = new FitAddon();
    term.loadAddon(addon);
    term.open(container.current);
    terminal.current = term;
    fit.current = addon;
    const terminalId = crypto.randomUUID();
    let live = true,
      open = false,
      offset = 0,
      sequence = 0,
      pending = '',
      writing = false;
    let poll: ReturnType<typeof setTimeout> | undefined;
    let batch: ReturnType<typeof setTimeout> | undefined;
    let resize: ReturnType<typeof setTimeout> | undefined;
    const close = () => request('terminal.close', { terminalId }).catch(() => undefined);
    const fail = (e: unknown) => {
      if (!live) return;
      open = false;
      setPhase('closed');
      setError(t('{{p0}}。连接已停止；命令结果请核对后再操作。', { p0: String(e) }));
      pending = '';
      void close();
    };
    async function flush() {
      batch = undefined;
      if (!live || !open || writing || !pending) return;
      writing = true;
      // UTF-8 may use four bytes per character. Never split a surrogate pair.
      const chars = Array.from(pending);
      const data = chars.slice(0, 900).join('');
      pending = chars.slice(900).join('');
      try {
        const result = await request<{ sequence: number }>('terminal.write', {
          terminalId,
          sequence,
          data,
        });
        if (result.sequence !== sequence + 1) throw new Error(t('终端输入确认顺序异常'));
        sequence = result.sequence;
      } catch (e) {
        fail(e);
      } finally {
        writing = false;
        if (live && open && pending) batch = setTimeout(() => void flush(), 100);
      }
    }
    send.current = (data) => {
      if (!open || !live) return;
      if (pending.length + data.length > 64 * 1024) {
        fail(t('输入过长，请减少粘贴内容'));
        return;
      }
      pending += data;
      if (!batch && !writing) batch = setTimeout(() => void flush(), 100);
    };
    const input = term.onData((data) => send.current(data));
    async function read() {
      if (!live || !open) return;
      try {
        const value = await request<Output>('terminal.read', { terminalId, offset });
        if (!live || !open) return;
        if (value.truncated) term.write(t('\r\n[较早的终端输出已超出缓冲区]\r\n'));
        if (value.data) {
          const bytes = Uint8Array.from(atob(value.data), (c) => c.charCodeAt(0));
          await new Promise<void>((resolve) => term.write(bytes, resolve));
        }
        offset = value.offset;
        if (value.eof) {
          open = false;
          setPhase('closed');
          term.write(t('\r\n[终端已结束]\r\n'));
          void close();
        } else poll = setTimeout(() => void read(), 200);
      } catch (e) {
        fail(e);
      }
    }
    const observer = new ResizeObserver(() => {
      if (resize) clearTimeout(resize);
      resize = setTimeout(() => {
        if (!live || !container.current?.clientWidth) return;
        addon.fit();
      }, 100);
    });
    observer.observe(container.current);
    const resized = term.onResize(({ cols, rows }) => {
      if (live && open)
        void request('terminal.resize', {
          terminalId,
          cols: Math.min(500, cols),
          rows: Math.min(200, rows),
        }).catch(fail);
    });
    setPhase('connecting');
    setError('');
    addon.fit();
    void request('terminal.open', {
      projectId,
      terminalId,
      cols: Math.min(500, Math.max(2, term.cols)),
      rows: Math.min(200, Math.max(1, term.rows)),
    })
      .then(() => {
        if (!live) {
          void close();
          return;
        }
        open = true;
        setPhase('open');
        term.focus();
        void read();
      })
      .catch(fail);
    return () => {
      live = false;
      open = false;
      send.current = () => undefined;
      if (poll) clearTimeout(poll);
      if (batch) clearTimeout(batch);
      if (resize) clearTimeout(resize);
      observer.disconnect();
      input.dispose();
      resized.dispose();
      term.dispose();
      terminal.current = undefined;
      fit.current = undefined;
      void close();
    };
  }, [request, active, connected, projectId, generation]);
  useEffect(() => {
    if (visible)
      requestAnimationFrame(() => {
        fit.current?.fit();
        if (phase === 'open') terminal.current?.focus();
      });
  }, [visible, phase]);
  return (
    <section className="ssh-tool" aria-label={t('终端')} data-phase={phase}>
      {phase === 'closed' && (
        <div className="ssh-status">
          <span>{t('连接已结束')}</span>
          <button
            disabled={!connected}
            onClick={() => {
              setGeneration((value) => value + 1);
              setActive(true);
            }}
          >
            {t('启动终端')}
          </button>
        </div>
      )}
      {error && (
        <p className="error ssh-error" role="alert">
          {errorText(error)}
        </p>
      )}
      <div className="ssh-screen" ref={container} />
      <div className="ssh-keys" aria-label={t('终端快捷键')}>
        {[
          ['Esc', '\x1b'],
          ['Tab', '\t'],
          ['Ctrl+C', '\x03'],
          ['Ctrl+D', '\x04'],
          ['↑', '\x1b[A'],
          ['↓', '\x1b[B'],
        ].map(([label, data]) => (
          <button
            key={label}
            disabled={phase !== 'open'}
            onClick={() => {
              send.current(data!);
              terminal.current?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
