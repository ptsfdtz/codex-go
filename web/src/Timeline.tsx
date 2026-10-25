import { Component, createRef, type ReactNode } from 'react';
import { motionDuration, MotionPresence } from './motion';

type Position = { bottom: boolean; key?: string; top: number; scrollTop: number };
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
  private following = true;
  private userIntent = false;
  private touchY?: number;
  private olderRequested = false;
  private knownItems = new WeakSet<Element>();
  private revealNewItems(animate: boolean) {
    const node = this.element.current;
    if (!node) return;
    const viewport = node.getBoundingClientRect();
    for (const item of node.querySelectorAll<HTMLElement>('[data-history-key]')) {
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
    this.revealNewItems(false);
    this.position = this.readPosition();
    this.observer = new ResizeObserver(() => this.restore(this.position));
    if (this.content.current) this.observer.observe(this.content.current);
  }
  componentWillUnmount() {
    this.observer?.disconnect();
  }
  getSnapshotBeforeUpdate(previous: Readonly<Props>): Position | null {
    if (previous.identity !== this.props.identity) return null;
    return this.readPosition();
  }
  private readPosition(): Position | null {
    const node = this.element.current;
    if (!node) return null;
    const top = node.getBoundingClientRect().top;
    const anchor = [...node.querySelectorAll<HTMLElement>('[data-history-key]')].find(
      (item) => item.getBoundingClientRect().bottom > top,
    );
    return {
      bottom: this.following && node.scrollHeight - node.clientHeight - node.scrollTop < 48,
      key: anchor?.dataset.historyKey,
      top: anchor?.getBoundingClientRect().top || 0,
      scrollTop: node.scrollTop,
    };
  }
  componentDidUpdate(previous: Readonly<Props>, _state: unknown, position: Position | null) {
    if (previous.identity !== this.props.identity) {
      this.userIntent = false;
      this.olderRequested = false;
      if (this.state.away || this.state.unread) this.setState({ away: false, unread: false });
    } else if (previous.revision !== this.props.revision && !this.following && !this.state.unread) {
      this.setState({ unread: true });
    }
    this.restore(position);
    this.revealNewItems(
      previous.identity === this.props.identity &&
        previous.animateNewItems === true &&
        this.props.animateNewItems === true &&
        this.following &&
        !this.props.loadingOlder,
    );
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
      const anchor = [...node.querySelectorAll<HTMLElement>('[data-history-key]')].find(
        (item) => item.dataset.historyKey === position.key,
      );
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
              const bottom = node.scrollHeight - node.clientHeight - node.scrollTop < 48;
              this.following = bottom;
              if (this.state.away === bottom || (bottom && this.state.unread))
                this.setState({ away: !bottom, unread: bottom ? false : this.state.unread });
              if (node.scrollTop < (this.position?.scrollTop || 0)) this.older();
            }
            this.position = this.readPosition();
          }
        }}
        onWheel={(event) => {
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
          if (['ArrowUp', 'PageUp', 'Home'].includes(event.key)) {
            this.userIntent = true;
            this.olderRequested = false;
            this.pause();
            this.older();
          }
        }}
        tabIndex={0}
        aria-label="会话消息"
        onTouchStart={(event) => {
          this.userIntent = true;
          this.touchY = event.touches[0]?.clientY;
          this.olderRequested = false;
          this.pause();
        }}
        onTouchMove={(event) => {
          const y = event.touches[0]?.clientY;
          if (y !== undefined && this.touchY !== undefined && y > this.touchY) this.older();
          this.touchY = y;
        }}
      >
        <div ref={this.content}>{this.props.children}</div>
        <MotionPresence>
          {this.state.away && (
            <button
              className="ghost follow-latest"
              onClick={() => {
                this.following = true;
                this.userIntent = false;
                this.setState({ away: false, unread: false });
                const node = this.element.current;
                if (node) node.scrollTop = node.scrollHeight;
                this.position = this.readPosition();
              }}
            >
              {this.state.unread ? '有新进展，查看最新' : '回到最新'}
            </button>
          )}
        </MotionPresence>
      </div>
    );
  }
}
