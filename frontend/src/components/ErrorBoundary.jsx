import React from "react";
import { walAppend } from "../lib/fieldStore";

/**
 * Catches render/calc errors in a subtree. Recovery is silent: it retries the
 * render once automatically (transient bad input), and only then shows a compact
 * fallback with a manual retry. Resets whenever `resetKey` changes (e.g. route).
 */
export default class ErrorBoundary extends React.Component {
  state = { error: null, retries: 0 };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    try {
      walAppend("ui_error", {
        scope: this.props.name || "app",
        message: String(error?.message || error).slice(0, 300),
        stack: String(info?.componentStack || "").slice(0, 500),
      });
    } catch { /* logging must never throw */ }
    if (this.state.retries < 1) {
      this.timer = setTimeout(() => this.setState((s) => ({ error: null, retries: s.retries + 1 })), 250);
    }
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null, retries: 0 });
  }

  componentWillUnmount() { clearTimeout(this.timer); }

  reset = () => this.setState({ error: null, retries: 0 });

  render() {
    const { error, retries } = this.state;
    if (!error) return this.props.children;
    if (retries < 1) return null; // silent first retry
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div role="alert" data-testid="error-boundary-fallback" className="m-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-slate-900">
        <p className="font-bold">This panel hit a problem and was isolated.</p>
        <p className="mt-1 text-slate-600">Your saved field data is unaffected.</p>
        <button type="button" onClick={this.reset} className="mt-3 rounded-md bg-[#FF6B1A] px-3 py-1.5 font-semibold text-white">
          Retry
        </button>
      </div>
    );
  }
}
