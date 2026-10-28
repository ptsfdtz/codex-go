import {
  Component,
  Suspense,
  lazy,
  useMemo,
  useState,
  type FunctionComponent,
  type ReactNode,
} from 'react';

class LoadFailure extends Component<
  { children: ReactNode; retry: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="module-status" role="alert">
        <span>此区域未能加载</span>
        <button onClick={this.props.retry}>重试</button>
      </div>
    ) : (
      this.props.children
    );
  }
}

// A stable lazy component shared by every instance. Retry replaces only the
// failed boundary, preserving the surrounding conversation and unsent draft.
export function deferred<P extends object>(
  load: () => Promise<{ default: FunctionComponent<P> }>,
  fallback?: (props: P) => ReactNode,
) {
  const initial = lazy(load);
  return function Deferred(props: P) {
    const [attempt, setAttempt] = useState(0);
    const View = useMemo(() => (attempt ? lazy(load) : initial), [attempt]);
    return (
      <LoadFailure key={attempt} retry={() => setAttempt((value) => value + 1)}>
        <Suspense
          fallback={
            fallback ? (
              fallback(props)
            ) : (
              <div className="module-status" role="status">
                加载中…
              </div>
            )
          }
        >
          <View {...props} />
        </Suspense>
      </LoadFailure>
    );
  };
}
