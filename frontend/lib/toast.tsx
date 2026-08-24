/**
 * Toast notification utilities.
 * Bridges between the optimistic transaction manager and the UI toast system.
 * Note: Must be used within components (uses the useToast hook internally via context).
 */
import { toast } from "@/hooks/use-toast"
import { ToastAction } from "@/components/ui/toast"

export type ToastType = "success" | "error" | "info" | "warning"

const STELLAR_EXPERT_BASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet"
    ? "https://stellar.expert/explorer/public"
    : "https://stellar.expert/explorer/testnet"

interface ToastTitleOptions {
  /** Pre-translated title. Falls back to the English default when omitted. */
  title?: string
  /** Pre-translated label for the "View on Explorer" action, when a txHash is provided. */
  viewOnExplorerLabel?: string
}

class ToastManager {
  success(message: string, duration?: number, txHash?: string, options?: ToastTitleOptions) {
    const viewOnExplorerLabel = options?.viewOnExplorerLabel ?? "View on Explorer"
    toast({
      title: options?.title ?? "Success",
      description: message,
      variant: "success",
      duration,
      action: txHash ? (
        <ToastAction
          altText={viewOnExplorerLabel}
          onClick={() => window.open(`${STELLAR_EXPERT_BASE}/tx/${txHash}`, "_blank")}
        >
          {viewOnExplorerLabel}
        </ToastAction>
      ) : undefined,
    })
  }

  error(message: string, _duration?: number, options?: ToastTitleOptions) {
    toast({
      title: options?.title ?? "Error",
      description: message,
      variant: "error",
      // Errors require manual dismissal - no duration
    })
  }

  info(message: string, duration?: number, options?: ToastTitleOptions) {
    toast({
      title: options?.title ?? "Info",
      description: message,
      variant: "info",
      duration,
    })
  }

  warning(message: string, duration?: number, options?: ToastTitleOptions) {
    toast({
      title: options?.title ?? "Warning",
      description: message,
      variant: "warning",
      duration,
    })
  }
}

export const toastManager = new ToastManager()
