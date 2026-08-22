"use client"

import { useState } from "react"
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
      toast({ title: "Export complete", description: "CSV file has been downloaded." })
      setExportDialogOpen(false)
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Failed to export data",
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
        title: "Messages sent",
        description: `Sent to ${result.sent} pool(s). ${result.failed > 0 ? `${result.failed} failed.` : ""}`,
      })
      setMessageText("")
      setMessageDialogOpen(false)
    } catch (err) {
      toast({
        title: "Send failed",
        description: err instanceof Error ? err.message : "Failed to send messages",
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
            {allSelected ? "Deselect All" : "Select All"}
          </Button>
          {selectedCount > 0 && <Badge variant="secondary">{selectedCount} selected</Badge>}
        </div>

        <Button
          variant="outline"
          size="sm"
          disabled={selectedCount === 0}
          onClick={() => setExportDialogOpen(true)}
        >
          <Download className="h-4 w-4 mr-1" />
          Export CSV
        </Button>

        <Button
          variant="outline"
          size="sm"
          disabled={selectedCount === 0}
          onClick={() => setMessageDialogOpen(true)}
        >
          <MessageSquare className="h-4 w-4 mr-1" />
          Send Message
        </Button>
      </div>

      {/* Export Confirmation Dialog */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export Pool Data</DialogTitle>
            <DialogDescription>
              Download a combined CSV of all activity from {selectedCount} selected pool(s).
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <p className="text-sm text-muted-foreground">
              The export will include all activity records (deposits, withdrawals, payouts, etc.)
              from the selected pools.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleExport} disabled={isExporting}>
              {isExporting ? "Exporting..." : "Download CSV"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send Message Dialog */}
      <Dialog open={messageDialogOpen} onOpenChange={setMessageDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Message to Pools</DialogTitle>
            <DialogDescription>
              Your message will be posted to the chat of {selectedCount} selected pool(s).
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Textarea
              placeholder="Type your message here..."
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
              Cancel
            </Button>
            <Button onClick={handleSendMessage} disabled={isSending || !messageText.trim()}>
              {isSending ? "Sending..." : "Send Message"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
