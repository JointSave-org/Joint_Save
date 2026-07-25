"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"

const shortcuts: { keys: string[]; description: string }[] = [
  { keys: ["c"], description: "Create a new pool" },
  { keys: ["g", "h"], description: "Go to My Groups" },
  { keys: ["g", "f"], description: "Go to Portfolio" },
  { keys: ["g", "t"], description: "Go to Transactions" },
  { keys: ["g", "p"], description: "Go to Profile" },
  { keys: ["?"], description: "Open keyboard shortcuts" },
]

export function KeyboardShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Use these shortcuts to navigate the dashboard quickly.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.keys.join("-")} className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{shortcut.description}</span>
              <span className="flex items-center gap-1.5">
                {shortcut.keys.map((key, i) => (
                  <span key={key} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-xs text-muted-foreground">then</span>}
                    <Kbd>{key === " " ? "Space" : key}</Kbd>
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
