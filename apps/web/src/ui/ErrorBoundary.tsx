/**
 * Crash safety net. React has no hooks-based error boundary, so this is the one
 * class component in the app.
 *
 * Two variants:
 *  - `app` — a branded full-screen fallback with a Reload button, used at the
 *    root so a catastrophic error never white-screens the user (their boards are
 *    autosaved locally, so a reload recovers them).
 *  - `silent` — renders nothing on error, used to wrap each floating overlay so
 *    one misbehaving overlay (a card, a layer, the prompt bar) disappears
 *    quietly while the canvas and every sibling overlay keep working.
 *
 * Either way the error is logged to the console with the surface label so it's
 * diagnosable in early testing without a logging service wired up.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  variant?: 'app' | 'silent';
  /** Which surface this guards — used in the console log. */
  label?: string;
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
    // eslint-disable-next-line no-console
    console.error(`[Jarwiz] ${this.props.label ?? 'component'} crashed:`, error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    if (this.props.variant === 'silent') return null;
    return <AppCrash error={this.state.error} />;
  }
}

/** Wrap a non-critical overlay so its crash can't take down the canvas. */
export function Safe({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ErrorBoundary variant="silent" label={label}>
      {children}
    </ErrorBoundary>
  );
}

function AppCrash({ error }: { error: Error }) {
  return (
    <div className="jz-crash" role="alert">
      <div className="jz-crash-card">
        <div className="jz-crash-spark" aria-hidden>✦</div>
        <h1 className="jz-crash-title">Something went wrong</h1>
        <p className="jz-crash-body">
          Jarwiz hit an unexpected error. Your boards are saved on this device — reloading will
          bring them back.
        </p>
        <button className="jz-crash-reload" onClick={() => window.location.reload()}>
          Reload Jarwiz
        </button>
        <details className="jz-crash-details">
          <summary>Technical details</summary>
          <pre>{error.message}</pre>
        </details>
      </div>
    </div>
  );
}
