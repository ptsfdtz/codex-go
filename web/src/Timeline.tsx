import { Component, createRef, type ReactNode } from 'react';

type Position = { bottom: boolean; key?: string; top: number; scrollTop: number };
export class Timeline extends Component<
  { identity: string; children: ReactNode },
  object,
  Position | null
> {
  private element = createRef<HTMLDivElement>();
  private content = createRef<HTMLDivElement>();
  private position: Position | null = null;
  private observer?: ResizeObserver;
  private following = true;
  pause() {
    this.following = false;
    this.position = this.readPosition();
  }
  componentDidMount() {
    this.position = this.readPosition();
    this.observer = new ResizeObserver(() => this.restore(this.position));
    if (this.content.current) this.observer.observe(this.content.current);
  }
  componentWillUnmount() {
    this.observer?.disconnect();
  }
  getSnapshotBeforeUpdate(
    previous: Readonly<{ identity: string; children: ReactNode }>,
  ): Position | null {
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
  componentDidUpdate(_previous: unknown, _state: unknown, position: Position | null) {
    this.restore(position);
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
          if (this.element.current?.scrollTop !== this.position?.scrollTop)
            this.position = this.readPosition();
        }}
        onWheel={(event) => {
          const node = this.element.current;
          if (node) {
            this.following =
              event.deltaY > 0 && node.scrollHeight - node.clientHeight - node.scrollTop < 64;
            this.position = this.readPosition();
          }
        }}
        onTouchStart={() => this.pause()}
      >
        <div ref={this.content}>{this.props.children}</div>
        <button
          className="ghost follow-latest"
          onClick={() => {
            this.following = true;
            const node = this.element.current;
            if (node) node.scrollTop = node.scrollHeight;
            this.position = this.readPosition();
          }}
        >
          回到最新
        </button>
      </div>
    );
  }
}
