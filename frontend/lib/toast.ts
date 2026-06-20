/**
 * Toast notification utilities.
 * Bridges between the optimistic transaction manager and the UI toast system.
 * Note: Must be used within components (uses the useToast hook internally via context).
 */
import { toast } from "@/hooks/use-toast";

export type ToastType = "success" | "error" | "info" | "warning";

class ToastManager {
  success(message: string, duration?: number) {
    toast({
      title: "Success",
      description: message,
      variant: "default",
    });
  }

  error(message: string, duration?: number) {
    toast({
      title: "Error",
      description: message,
      variant: "destructive",
    });
  }

  info(message: string, duration?: number) {
    toast({
      title: "Info",
      description: message,
      variant: "default",
    });
  }

  warning(message: string, duration?: number) {
    toast({
      title: "Warning",
      description: message,
      variant: "destructive",
    });
  }
}

export const toastManager = new ToastManager();
