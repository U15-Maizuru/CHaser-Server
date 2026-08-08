import { Component, type ErrorInfo, type ReactNode } from 'react';
import { BG_ROOT, TEXT_PRIMARY, TEXT_MUTED, FONT_UI } from '../ui';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={root}>
          <div style={title}>画面の表示中にエラーが発生しました</div>
          <div style={message}>{this.state.error.message}</div>
        </div>
      );
    }
    return this.props.children;
  }
}

const root: React.CSSProperties = {
  height: '100vh', display: 'flex', flexDirection: 'column',
  alignItems: 'center', justifyContent: 'center', gap: 8,
  background: BG_ROOT, color: TEXT_PRIMARY, fontFamily: FONT_UI, padding: 24,
};

const title: React.CSSProperties = { fontSize: 16, fontWeight: 700 };
const message: React.CSSProperties = { fontSize: 12, color: TEXT_MUTED, fontFamily: 'monospace' };
