"use client"

import React, { Component, type ErrorInfo, type ReactNode } from "react"
import Link from "next/link"
import { AlertTriangle, ChevronDown, ChevronUp, Home, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { reportClientError } from "@/lib/error-reporting"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: ReactNode
  /** Human-readable name shown in fallback UI (e.g. "Dashboard", "Members List"). */
  sectionName?: string
  /** When true, renders a compact inline fallback suited for inner sections. */
  compact?: boolean
  /** Optional callback fired when the user clicks "Try Again". */
  onReset?: () => void
  /** Connected wallet address — forwarded to the error reporter. */
  walletAddress?: string | null
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  showDetails: boolean
}

// ---------------------------------------------------------------------------
// ErrorBoundary (class component — required by React's componentDidCatch API)
// ---------------------------------------------------------------------------

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null, showDetails: false }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log to console for developer visibility
    console.error(
      `[ErrorBoundary${this.props.sectionName ? ` – ${this.props.sectionName}` : ""}]`,
      error,
      errorInfo,
    )

    // Report to backend (fire-and-forget)
    reportClientError({
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack ?? undefined,
      walletAddress: this.props.walletAddress ?? undefined,
      sectionName: this.props.sectionName,
    })
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null, showDetails: false })
    this.props.onReset?.()
  }

  private toggleDetails = (): void => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }))
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children
    }

    const { sectionName, compact } = this.props
    const { error, showDetails } = this.state
    const label = sectionName ?? "this section"

    // ── Compact fallback (inner section boundaries) ─────────────────────
    if (compact) {
      return (
        <Card className="p-4 border-destructive/30 bg-destructive/5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-destructive">
                Failed to load {label}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                An unexpected error occurred in this section.
              </p>

              {/* Expandable error details */}
              <button
                onClick={this.toggleDetails}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-2 transition-colors"
              >
                {showDetails ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {showDetails ? "Hide details" : "Show details"}
              </button>

              {showDetails && error && (
                <pre className="mt-2 p-2 rounded bg-muted/50 text-[11px] leading-relaxed overflow-auto max-h-32 whitespace-pre-wrap break-all font-mono">
                  {error.message}
                  {error.stack && `\n\n${error.stack}`}
                </pre>
              )}

              <div className="mt-3">
                <Button variant="outline" size="sm" onClick={this.handleReset}>
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Try Again
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )
    }

    // ── Full-page fallback (page-level boundaries) ──────────────────────
    return (
      <div className="min-h-[50vh] flex items-center justify-center px-4">
        <Card className="max-w-lg w-full p-8 text-center border-destructive/30 bg-destructive/5">
          <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />

          <h2 className="text-xl font-semibold mb-2">Something went wrong</h2>
          <p className="text-muted-foreground text-sm mb-6">
            An unexpected error occurred while loading {label}. You can try again or return to the
            dashboard.
          </p>

          {/* Expandable error details */}
          <button
            onClick={this.toggleDetails}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors mx-auto"
          >
            {showDetails ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            {showDetails ? "Hide error details" : "Show error details"}
          </button>

          {showDetails && error && (
            <pre className="mb-6 p-3 rounded bg-muted/50 text-[11px] leading-relaxed overflow-auto max-h-48 whitespace-pre-wrap break-all font-mono text-left">
              {error.message}
              {error.stack && `\n\n${error.stack}`}
            </pre>
          )}

          <div className="flex items-center justify-center gap-3">
            <Button onClick={this.handleReset}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
            <Button variant="outline" asChild>
              <Link href="/dashboard">
                <Home className="h-4 w-4 mr-2" />
                Go to Dashboard
              </Link>
            </Button>
          </div>
        </Card>
      </div>
    )
  }
}

// ---------------------------------------------------------------------------
// SectionErrorBoundary — convenience wrapper for inner section boundaries
// ---------------------------------------------------------------------------

interface SectionErrorBoundaryProps {
  children: ReactNode
  sectionName: string
  walletAddress?: string | null
  onReset?: () => void
}

/**
 * Convenience wrapper that renders a compact error fallback.
 * Use this inside page layouts to isolate individual sections.
 */
export function SectionErrorBoundary({
  children,
  sectionName,
  walletAddress,
  onReset,
}: SectionErrorBoundaryProps) {
  return (
    <ErrorBoundary
      sectionName={sectionName}
      compact
      walletAddress={walletAddress}
      onReset={onReset}
    >
      {children}
    </ErrorBoundary>
  )
}
