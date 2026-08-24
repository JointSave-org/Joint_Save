"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Download, MessageSquare, CheckSquare, Square } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import type { AdminPoolData } from "@/app/api/admin/pools/route"

export function BulkOperations({
  pools,
  selectedPoolIds,
  onSelectAll,
  onDeselectAll,
  onExport,
  onSendMessage,
}: {
  pools: AdminPoolData[]
  selectedPoolIds: Set<string>
  onSelectAll: () => void
  onDeselectAll: () => void
  onExport: (poolIds: string[]) => Promise<void>
  onSendMessage: (poolIds: string[], message: string) => Promise<{ sent: number; failed: number }>
}) {
  const t = useTranslations("admin.bulkOps")
  const { toast } = useToast()
  const [messageDialogOpen, setMessageDialogOpen] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [messageText, setMessageText] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const selectedCount = selectedPoolIds.size
  const allSelected = selectedCount === pools.length && pools.length > 0

  const handleExport = async () => {
    if (selectedCount === 0) return
    setIsExporting(true)
    try {
      await onExport(Array.from(selectedPoolIds))
      toast({ title: t("toastExportCompleteTitle"), description: t("toastExportCompleteBody") })
      setExportDialogOpen(false)
    } catch (err) {
      toast({
        title: t("toastExportFailedTitle"),
        description: err instanceof Error ? err.message : t("toastExportFailedBody"),
        variant: "destructive",
      })
    } finally {
      setIsExporting(false)
    }
  }

  const handleSendMessage = async () => {
    if (selectedCount === 0 || !messageText.trim()) return
    setIsSending(true)
    try {
      const result = await onSendMessage(Array.from(selectedPoolIds), messageText)
      toast({
        title: t("toastMessagesSentTitle"),
        description: t("toastMessagesSentBody", {
          sent: result.sent,
          failedSuffix:
            result.failed > 0 ? t("toastMessagesSentFailedSuffix", { failed: result.failed }) : "",
        }),
      })
      setMessageText("")
      setMessageDialogOpen(false)
    } catch (err) {
      toast({
        title: t("toastSendFailedTitle"),
        description: err instanceof Error ? err.message : t("toastSendFailedBody"),
        variant: "destructive",
      })
    } finally {
      setIsSending(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 mr-2">
          <Button variant="outline" size="sm" onClick={allSelected ? onDeselectAll : onSelectAll}>
            {allSelected ? (
              <CheckSquare className="h-4 w-4 mr-1" />
            ) : (
              <Square className="h-4 w-4 mr-1" />
            )}
            {allSelected ? t("deselectAll") : t("selectAll")}
          </Button>
          {selectedCount > 0 && (
            <Badge variant="secondary">{t("selected", { count: selectedCount })}</Badge>
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={selectedCount === 0}
          onClick={() => setExportDialogOpen(true)}
        >
          <Download className="h-4 w-4 mr-1" />
          {t("exportCsv")}
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={selectedCount === 0}
          onClick={() => setMessageDialogOpen(true)}
        >
          <MessageSquare className="h-4 w-4 mr-1" />
          {t("sendMessage")}
        </Button>
      </div>

      {/* Export Confirmation Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("exportDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("exportDialogDescription", { count: selectedCount })}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">{t("exportDialogBody")}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleExport} disabled={isExporting}>
              {isExporting ? t("exporting") : t("downloadCsv")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Message Dialog */}
      <Dialog open={messageDialogOpen} onOpenChange={setMessageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("messageDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("messageDialogDescription", { count: selectedCount })}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Textarea
              placeholder={t("messagePlaceholder")}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              rows={4}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground mt-1 text-right">
              {messageText.length}/500
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMessageDialogOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={handleSendMessage} disabled={isSending || !messageText.trim()}>
              {isSending ? t("sending") : t("sendMessageBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
