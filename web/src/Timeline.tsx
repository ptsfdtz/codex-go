import { t } from './i18n';
import { Component, createRef, type ReactNode } from 'react';
import { ArrowDown } from 'lucide-react';
import { animateContentChange, motionDuration, MotionPresence } from './motion';

type Position = {
  bottom: boolean;
  key?: string;
  anchor?: HTMLElement;
  top: number;
  scrollTop: number;
};
type Props = {
  identity: string;
  children: ReactNode;
  revision?: number;
  animateNewItems?: boolean;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onOlder?: () => void;
};
export class Timeline extends Component<
  Props,
  { away: boolean; unread: boolean },
  Position | null
> {
  state = { away: false, unread: false };
  private element = createRef<HTMLDivElement>();
  private content = createRef<HTMLDivElement>();
  private position: Position | null = null;
  private observer?: ResizeObserver;
  private itemsObserver?: MutationObserver;
  private transition?: Animation;
  private following = true;
  private userIntent = false;
  private touchY?: number;
  private olderRequested = false;
  private knownItems = new WeakSet<Element>();
  private revealNewItems(animate: boolean, items: Iterable<HTMLElement>) {
    const node = this.element.current;
    if (!node) return;
    const viewport = node.getBoundingClientRect();
    for (const item of items) {
      if (this.knownItems.has(item)) continue;
      this.knownItems.add(item);
      if (!animate) continue;
      const box = item.getBoundingClientRect();
      if (box.bottom <= viewport.top || box.top >= viewport.bottom) continue;
      item.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: motionDuration(160),
        easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
      });
    }
  }
  pause() {
    this.following = false;
    this.position = this.readPosition();
  }
  componentDidMount() {
    this.revealNewItems(
      false,
      this.element.current!.querySelectorAll<HTMLElement>('[data-history-key]'),
    );
    this.itemsObserver = new MutationObserver((records) => {
      const items = new Set<HTMLElement>();
      for (const record of records)
        for (const added of record.addedNodes) {
          if (!(added instanceof HTMLElement)) continue;
          if (added.matches('[data-history-key]')) items.add(added);
          for (const item of added.querySelectorAll<HTMLElement>('[data-history-key]'))
            items.add(item);
        }
      this.revealNewItems(
        this.following && this.props.animateNewItems === true && !this.props.loadingOlder,
        items,
      );
    });
    this.itemsObserver.observe(this.content.current!, { childList: true, subtree: true });
    this.position = this.readPosition();
    this.observer = new ResizeObserver(() => this.restore(this.position));
    if (this.content.current) this.observer.observe(this.content.current);
  }
  componentWillUnmount() {
    this.observer?.disconnect();
    this.itemsObserver?.disconnect();
    this.transition?.cancel();
  }
  getSnapshotBeforeUpdate(previous: Readonly<Props>): Position | null {
    if (previous.identity !== this.props.identity) return null;
    return this.readPosition();
  }
  private readPosition(): Position | null {
    const node = this.element.current;
    if (!node) return null;
    // Streaming while following the end needs no history traversal or layout
    // measurements for offscreen messages.
    if (this.following) return { bottom: true, top: 0, scrollTop: node.scrollTop };
    const top = node.getBoundingClientRect().top;
    let anchor = this.position?.anchor;
    if (
      !anchor ||
      !node.contains(anchor) ||
      anchor.getBoundingClientRect().top > top ||
      anchor.getBoundingClientRect().bottom <= top
    ) {
      anchor = undefined;
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT, {
        acceptNode(element) {
          const item = element as HTMLElement;
          return item.matches('[data-history-key]') &&
            item.getClientRects().length &&
            item.getBoundingClientRect().bottom > top
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_SKIP;
        },
      });
      anchor = walker.nextNode() as HTMLElement | undefined;
    }
    return {
      bottom: this.following,
      key: anchor?.dataset.historyKey,
      anchor,
      top: anchor?.getBoundingClientRect().top || 0,
      scrollTop: node.scrollTop,
    };
  }
  componentDidUpdate(previous: Readonly<Props>, _state: unknown, position: Position | null) {
    if (previous.identity !== this.props.identity) {
      this.transition?.cancel();
      this.transition = this.content.current
        ? animateContentChange(this.content.current)
        : undefined;
      this.userIntent = false;
      this.olderRequested = false;
      if (this.state.away || this.state.unread) this.setState({ away: false, unread: false });
    } else if (previous.revision !== this.props.revision && !this.following && !this.state.unread) {
      this.setState({ unread: true });
    }
    this.restore(position);
  }
  private older() {
    const node = this.element.current;
    if (
      this.userIntent &&
      node &&
      node.scrollTop < 80 &&
      this.props.hasOlder &&
      !this.props.loadingOlder &&
      !this.olderRequested
    ) {
      this.olderRequested = true;
      this.pause();
      this.props.onOlder?.();
    }
  }
  private restore(position: Position | null) {
    const node = this.element.current;
    if (!node) return;
    if (!position || position.bottom) {
      if (!position) this.following = true;
      node.scrollTop = node.scrollHeight;
    } else {
      const anchor =
        position.anchor && node.contains(position.anchor)
          ? position.anchor
          : position.key
            ? node.querySelector<HTMLElement>(`[data-history-key="${CSS.escape(position.key)}"]`)
            : null;
      node.scrollTop =
        position.scrollTop + (anchor ? anchor.getBoundingClientRect().top - position.top : 0);
    }
    this.position = this.readPosition();
  }
  render() {
    return (
      <div
        className="timeline"
        ref={this.element}
        onScroll={() => {
          // A delayed event from our own scroll restoration can arrive after
          // content has resized. Keep the saved anchor until ResizeObserver
          // compensates; only a changed offset represents a new position.
          const node = this.element.current;
          if (node && node.scrollTop !== this.position?.scrollTop) {
            if (this.userIntent) {
              const movingDown = node.scrollTop > (this.position?.scrollTop ?? node.scrollTop);
              const bottom =
                movingDown && node.scrollHeight - node.clientHeight - node.scrollTop < 48;
              this.following = bottom;
              if (this.state.away === bottom || (bottom && this.state.unread))
                this.setState({ away: !bottom, unread: bottom ? false : this.state.unread });
              if (node.scrollTop < (this.position?.scrollTop || 0)) this.older();
            }
            this.position = this.readPosition();
          }
        }}
        onWheel={(event) => {
          if ((event.target as HTMLElement).closest('textarea, input, [contenteditable="true"]'))
            return;
          const node = this.element.current;
          if (node) {
            this.userIntent = true;
            this.olderRequested = false;
            this.following =
              event.deltaY > 0 && node.scrollHeight - node.clientHeight - node.scrollTop < 64;
            if (event.deltaY < 0) {
              this.setState({ away: true });
              this.older();
            }
            this.position = this.readPosition();
          }
        }}
        onPointerDown={() => {
          this.userIntent = true;
          this.olderRequested = false;
        }}
        onKeyDown={(event) => {
          if ((event.target as HTMLElement).closest('textarea, input, [contenteditable="true"]'))
            return;
          if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) {
            this.userIntent = true;
            this.olderRequested = false;
            this.pause();
            this.setState({ away: true });
            this.older();
          }
        }}
        tabIndex={0}
        aria-label={t('会话消息')}
        onTouchStart={(event) => {
          if ((event.target as HTMLElement).closest('textarea, input, [contenteditable="true"]')) {
            this.touchY = undefined;
            return;
          }
          this.userIntent = true;
          this.touchY = event.touches[0]?.clientY;
          this.olderRequested = false;
        }}
        onTouchMove={(event) => {
          if ((event.target as HTMLElement).closest('textarea, input, [contenteditable="true"]'))
            return;
          const y = event.touches[0]?.clientY;
          if (y !== undefined && this.touchY !== undefined && y > this.touchY) {
            this.pause();
            this.setState({ away: true });
            this.older();
          }
          this.touchY = y;
        }}
      >
        <div ref={this.content}>{this.props.children}</div>
        <MotionPresence>
          {this.state.away && (
            <button
              className="ghost follow-latest"
              aria-label={this.state.unread ? t('有新进展，查看最新') : t('回到最新')}
              title={this.state.unread ? t('有新进展，查看最新') : t('回到最新')}
              onClick={() => {
                this.following = true;
                this.userIntent = false;
                this.setState({ away: false, unread: false });
                const node = this.element.current;
                if (node) node.scrollTop = node.scrollHeight;
                this.position = this.readPosition();
              }}
            >
              <ArrowDown size={18} aria-hidden="true" />
            </button>
          )}
        </MotionPresence>
      </div>
    );
  }
}
