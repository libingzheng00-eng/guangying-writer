import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 渲染进程顶层错误边界：任意一个组件在渲染期间抛出未捕获异常，
 * 整块界面会直接白屏且无任何提示。这个边界把崩溃收拢成一张可恢复面板，
 * 用户可「重新加载」而非丢失整个应用；同时把错误打到控制台，便于定位。
 */
export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // 生产环境也能在 DevTools / 控制台看到堆栈
    console.error('[光影写手] 渲染异常已被错误边界捕获：', error, info?.componentStack || '');
  }

  private handleReload = () => {
    // 仅重置边界，不刷新整个进程，避免丢失主进程状态
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="fatal">
        <div className="fatal__card">
          <div className="fatal__icon">!</div>
          <h1 className="fatal__title">界面出现了一点问题</h1>
          <p className="fatal__msg">光影写手已拦截这次崩溃，你的剧本数据通常仍然完好。</p>
          <pre className="fatal__detail">{error.message}</pre>
          <div className="fatal__actions">
            <button className="btn btn--primary" onClick={this.handleReload}>
              重新加载界面
            </button>
            <button
              className="btn btn--ghost"
              onClick={() => {
                try {
                  window.location.reload();
                } catch {
                  /* ignore */
                }
              }}
            >
              整页刷新
            </button>
          </div>
        </div>
      </div>
    );
  }
}
