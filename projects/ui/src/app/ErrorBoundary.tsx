import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  message: string | null;
}

/** Spec §7 requires an error boundary at the shell.
 *
 * It keeps the shell rendered so a thrown route does not take the navigation
 * with it — the operator can still move somewhere else rather than reloading. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { message: error instanceof Error ? error.message : "Unexpected error" };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Never swallowed: the operator sees the message, the console keeps the trace.
    // eslint-disable-next-line no-console
    console.error("unhandled error in the shell", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.message === null) return this.props.children;

    return (
      <div role="alert" className="p-6 text-12 text-text-2">
        <p className="font-semibold text-text-1">Something went wrong.</p>
        <p className="mt-1 text-text-3">{this.state.message}</p>
      </div>
    );
  }
}
