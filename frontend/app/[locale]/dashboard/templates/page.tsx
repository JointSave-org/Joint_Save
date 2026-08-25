"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { useRouter } from "@/i18n/navigation"
import { useStellar } from "@/components/web3-provider"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorBoundary } from "@/components/error-boundary"
import { CreateTemplateDialog } from "@/components/templates/create-template-dialog"
import { EditTemplateDialog } from "@/components/templates/edit-template-dialog"
import { toastManager } from "@/lib/toast"
import { formatRelativeTime } from "@/lib/utils"
import { type PoolTemplate, TEMPLATE_POOL_TYPES } from "@/lib/templates"
import { Plus, LayoutTemplate, Users, Repeat, Pencil, Trash2, ExternalLink } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

function TemplateCard({
  template,
  showOwnerActions,
  onUse,
  onEdit,
  onDelete,
}: {
  template: PoolTemplate
  showOwnerActions: boolean
  onUse: (template: PoolTemplate) => void
  onEdit: (template: PoolTemplate) => void
  onDelete: (template: PoolTemplate) => void
}) {
  const t = useTranslations("templates.card")
  const tType = useTranslations("templates.poolTypeLabels")
  const locale = useLocale()
  const config = template.config
  const memberCount = config.members?.length ? config.members.length + 1 : null
  const primaryAmount =
    template.pool_type === "rotational"
      ? config.amount
      : template.pool_type === "target"
        ? config.targetAmount
        : config.minimumDeposit

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold truncate">{template.name}</h3>
          <Badge variant="secondary" className="text-[10px] capitalize">
            {tType(template.pool_type)}
          </Badge>
          {template.is_public && (
            <Badge variant="outline" className="text-[10px]">
              {t("public")}
            </Badge>
          )}
        </div>

        {template.description && (
          <p className="text-sm text-muted-foreground mt-1">{template.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-2">
          {primaryAmount && (
            <span>
              {template.pool_type === "target" ? t("goal") : t("amount")}: {primaryAmount} XLM
            </span>
          )}
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {t("membersLabel", { count: memberCount ?? "—" })}
          </span>
          <span className="flex items-center gap-1">
            <Repeat className="h-3 w-3" />
            {t("usedTimes", { count: template.use_count })}
          </span>
          <span>
            {t("createdLabel", { time: formatRelativeTime(new Date(template.created_at), locale) })}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => onUse(template)}>
          <ExternalLink className="h-4 w-4 mr-1" />
          {t("useTemplate")}
        </Button>
        {showOwnerActions && (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onEdit(template)}
              aria-label={t("editAria")}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDelete(template)}
              aria-label={t("deleteAria")}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function TemplatesPageContent() {
  const t = useTranslations("templates.page")
  const tType = useTranslations("templates.poolTypeLabels")
  const { address, isConnected, isInitializing } = useStellar()
  const router = useRouter()

  const [activeTab, setActiveTab] = useState("mine")
  const [communityPoolType, setCommunityPoolType] = useState<string>("all")
  const [communitySort, setCommunitySort] = useState<string>("popular")

  const [mine, setMine] = useState<PoolTemplate[]>([])
  const [community, setCommunity] = useState<PoolTemplate[]>([])
  const [mineLoading, setMineLoading] = useState(false)
  const [communityLoading, setCommunityLoading] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [editing, setEditing] = useState<PoolTemplate | null>(null)

  useEffect(() => {
    if (!isInitializing && !isConnected) {
      router.replace("/")
    }
  }, [isInitializing, isConnected, router])

  const loadMine = useCallback(async () => {
    if (!address) return
    setMineLoading(true)
    try {
      const res = await fetch(`/api/templates?wallet=${encodeURIComponent(address.toLowerCase())}`)
      const data = res.ok ? await res.json() : { data: [] }
      setMine(data.data || [])
    } finally {
      setMineLoading(false)
    }
  }, [address])

  const loadCommunity = useCallback(async () => {
    setCommunityLoading(true)
    try {
      const params = new URLSearchParams()
      if (communityPoolType !== "all") params.set("pool_type", communityPoolType)
      params.set("sort", communitySort)
      params.set("page", "0")
      const res = await fetch(`/api/templates/community?${params.toString()}`)
      const data = res.ok ? await res.json() : { data: [] }
      setCommunity(data.data || [])
    } finally {
      setCommunityLoading(false)
    }
  }, [communityPoolType, communitySort])

  useEffect(() => {
    loadMine()
  }, [loadMine])

  useEffect(() => {
    loadCommunity()
  }, [loadCommunity])

  const handleUse = async (template: PoolTemplate) => {
    if (!address) {
      toastManager.error(t("connectWalletToUse"))
      return
    }
    await fetch(`/api/templates/${template.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-wallet-address": address },
      body: JSON.stringify({ incrementUse: true }),
    }).catch(() => {})
    router.push(`/dashboard/create/${template.pool_type}?template=${template.id}`)
  }

  const handleDelete = async (template: PoolTemplate) => {
    if (!address) return
    if (!window.confirm(t("deleteConfirm", { name: template.name }))) return
    try {
      const res = await fetch(`/api/templates/${template.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "x-wallet-address": address },
        body: JSON.stringify({ wallet: address }),
      })
      if (!res.ok) throw new Error(t("deleteFailed"))
      toastManager.success(t("deleted"))
      await Promise.all([loadMine(), loadCommunity()])
    } catch (error) {
      toastManager.error((error as Error).message || t("deleteFailed"))
    }
  }

  if (isInitializing || !isConnected) {
    return null
  }

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <LayoutTemplate className="h-7 w-7 text-primary" />
                {t("title")}
              </h1>
              <p className="text-muted-foreground mt-1">{t("subtitle")}</p>
            </div>
            <Button onClick={() => setCreateOpen(true)} className="shrink-0">
              <Plus className="h-4 w-4 mr-1" />
              {t("createButton")}
            </Button>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-2 mb-6">
              <TabsTrigger value="mine">{t("tabMine")}</TabsTrigger>
              <TabsTrigger value="community">{t("tabCommunity")}</TabsTrigger>
            </TabsList>

            <TabsContent value="mine" className="mt-0">
              {mineLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-24 w-full" />
                  ))}
                </div>
              ) : mine.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-10 text-center">
                  <LayoutTemplate className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="font-medium">{t("emptyMineTitle")}</p>
                  <p className="text-sm text-muted-foreground mt-1">{t("emptyMineBody")}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {mine.map((template) => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      showOwnerActions
                      onUse={handleUse}
                      onEdit={(t) => setEditing(t)}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="community" className="mt-0">
              <div className="flex flex-col sm:flex-row gap-3 mb-4">
                <Select value={communityPoolType} onValueChange={setCommunityPoolType}>
                  <SelectTrigger className="w-full sm:w-48">
                    <SelectValue placeholder={t("allTypes")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("allTypes")}</SelectItem>
                    {TEMPLATE_POOL_TYPES.map((pt) => (
                      <SelectItem key={pt} value={pt}>
                        {tType(pt)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={communitySort} onValueChange={setCommunitySort}>
                  <SelectTrigger className="w-full sm:w-48">
                    <SelectValue placeholder={t("sortPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="popular">{t("sortPopular")}</SelectItem>
                    <SelectItem value="recent">{t("sortRecent")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {communityLoading ? (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-24 w-full" />
                  ))}
                </div>
              ) : community.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-10 text-center">
                  <LayoutTemplate className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="font-medium">{t("emptyCommunityTitle")}</p>
                  <p className="text-sm text-muted-foreground mt-1">{t("emptyCommunityBody")}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {community.map((template) => (
                    <TemplateCard
                      key={template.id}
                      template={template}
                      showOwnerActions={template.creator_address === address?.toLowerCase()}
                      onUse={handleUse}
                      onEdit={(t) => setEditing(t)}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </main>

      <CreateTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        address={address}
        onSaved={() => {
          loadMine()
          loadCommunity()
        }}
      />
      <EditTemplateDialog
        template={editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        address={address}
        onSaved={() => {
          loadMine()
          loadCommunity()
        }}
      />
    </div>
  )
}

export default function TemplatesPage() {
  const t = useTranslations("templates.page")
  return (
    <ErrorBoundary sectionName={t("sectionTemplates")}>
      <TemplatesPageContent />
    </ErrorBoundary>
  )
}
