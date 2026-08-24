"use client"

import { useTranslations } from "next-intl"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"

const shortcuts: { keys: string[]; descriptionKey: string }[] = [
  { keys: ["c"], descriptionKey: "createPool" },
  { keys: ["g", "h"], descriptionKey: "goToGroups" },
  { keys: ["g", "f"], descriptionKey: "goToPortfolio" },
  { keys: ["g", "t"], descriptionKey: "goToTransactions" },
  { keys: ["g", "p"], descriptionKey: "goToProfile" },
  { keys: ["?"], descriptionKey: "openHelp" },
]

export function KeyboardShortcutsHelp({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useTranslations("common.keyboardShortcuts")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.keys.join("-")} className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {t(shortcut.descriptionKey)}
              </span>
              <span className="flex items-center gap-1.5">
                {shortcut.keys.map((key, i) => (
                  <span key={key} className="flex items-center gap-1.5">
                    {i > 0 && <span className="text-xs text-muted-foreground">{t("then")}</span>}
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
