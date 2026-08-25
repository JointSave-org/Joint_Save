"use client"

import { use, useMemo, useEffect, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { useSearchParams } from "next/navigation"
import { useRouter, redirect, Link } from "@/i18n/navigation"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { RotationalForm } from "@/components/create-group/rotational-form"
import { TargetForm } from "@/components/create-group/target-form"
import { FlexibleForm } from "@/components/create-group/flexible-form"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowLeft, LayoutTemplate, Loader2, CopyPlus } from "lucide-react"
import { ErrorBoundary } from "@/components/error-boundary"
import { useStellar } from "@/components/web3-provider"
import { UseTemplateDialog } from "@/components/templates/use-template-dialog"
import type { PoolTemplateConfig } from "@/lib/templates"

const validTypes = ["rotational", "target", "flexible"]

export interface DuplicatePrefill {
  name: string
  description: string
  /** Rotational: per-round contribution amount */
  amount: string
  /** Target pool: total savings goal */
  targetAmount: string
  /** Flexible pool: minimum deposit per transaction */
  minimumDeposit: string
  frequency: string
  /** Target pool: deadline in days from creation */
  deadlineDays?: string
  /** Flexible pool: withdrawal fee percent */
  withdrawalFee?: string
  /** Flexible pool: yield generation toggle */
  enableYield?: boolean
  members: string[]
  token: string
}

/** Map a template's stored config onto the form prefill shape. */
function configToPrefill(config: PoolTemplateConfig): DuplicatePrefill {
  return {
    name: config.name || "",
    description: config.description || "",
    amount: config.amount || "",
    targetAmount: config.targetAmount || "",
    minimumDeposit: config.minimumDeposit || "",
    frequency: config.frequency || "",
    deadlineDays: config.deadlineDays || "",
    withdrawalFee: config.withdrawalFee || "",
    enableYield: config.enableYield ?? false,
    members: config.members || [],
    token: config.token || "XLM",
  }
}

export default function CreateGroupPage({ params }: { params: Promise<{ type: string }> }) {
  const t = useTranslations("pool.create.page")
  const tPool = useTranslations("pool")
  const locale = useLocale()
  const { type } = use(params)
  const searchParams = useSearchParams()
  const router = useRouter()
  const { address } = useStellar()

  if (!validTypes.includes(type)) {
    redirect({ href: "/dashboard", locale })
  }

  const isOnboarding = searchParams.get("onboarding") === "1"
  const isDuplicate = searchParams.get("duplicate") === "1"
  const isCreateTemplate = searchParams.get("createTemplate") === "1"
  const templateId = searchParams.get("template")

  const [useTemplateOpen, setUseTemplateOpen] = useState(false)
  const [templatePrefill, setTemplatePrefill] = useState<DuplicatePrefill | null>(null)
  const [templateLoading, setTemplateLoading] = useState(false)
  const [templateError, setTemplateError] = useState<string | null>(null)

  useEffect(() => {
    if (!templateId) {
      setTemplatePrefill(null)
      setTemplateError(null)
      return
    }
    let cancelled = false
    setTemplateLoading(true)
    setTemplateError(null)
    fetch(`/api/templates?id=${encodeURIComponent(templateId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(t("templateNotFound"))
        const template = await res.json()
        if (cancelled) return
        if (template.pool_type !== type) {
          router.replace(`/dashboard/create/${template.pool_type}?template=${template.id}`)
          return
        }
        setTemplatePrefill(configToPrefill(template.config))
      })
      .catch((error) => {
        if (!cancelled) setTemplateError((error as Error).message || t("failedToLoadTemplate"))
      })
      .finally(() => {
        if (!cancelled) setTemplateLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [templateId, type, router, t])

  const prefill: DuplicatePrefill | undefined = useMemo(() => {
    if (templateId) return templatePrefill ?? undefined
    if (!isDuplicate && !isOnboarding) return undefined
    try {
      const membersRaw = searchParams.get("members")
      const members = membersRaw ? JSON.parse(decodeURIComponent(membersRaw)) : []
      return {
        name: decodeURIComponent(searchParams.get("name") || ""),
        description: decodeURIComponent(searchParams.get("description") || ""),
        amount: searchParams.get("amount") || "",
        targetAmount: searchParams.get("targetAmount") || "",
        minimumDeposit: searchParams.get("minimumDeposit") || "",
        frequency: searchParams.get("frequency") || "",
        members,
        token: searchParams.get("token") || "XLM",
      }
    } catch {
      return undefined
    }
  }, [searchParams, isDuplicate, isOnboarding, templateId, templatePrefill])

  const titles = {
    rotational: t("titles.rotational"),
    target: t("titles.target"),
    flexible: t("titles.flexible"),
  }

  return (
    <ErrorBoundary sectionName={t("sectionName")}>
      <div className="min-h-screen bg-background">
        <DashboardHeader />
        <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="max-w-3xl mx-auto">
            <Button variant="ghost" className="mb-6" asChild>
              <Link href="/dashboard">
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t("backToDashboard")}
              </Link>
            </Button>

            <Card className="p-8">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="text-3xl font-bold mb-2">
                    {templateId && templatePrefill
                      ? t("titleNewFromTemplate", { name: templatePrefill.name })
                      : isDuplicate && prefill
                        ? t("titleNewCycle", { name: prefill.name })
                        : isOnboarding
                          ? t("titleOnboarding", {
                              type: tPool(`type.${type}` as "type.rotational"),
                            })
                          : titles[type as keyof typeof titles]}
                  </h1>
                  <p className="text-muted-foreground mb-4">
                    {templateId && templatePrefill
                      ? t("subtitlePrefilledTemplate")
                      : isCreateTemplate
                        ? t("subtitleCreateTemplate")
                        : isDuplicate
                          ? t("subtitleDuplicate")
                          : isOnboarding
                            ? t("subtitleOnboarding")
                            : t("subtitleDefault")}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => setUseTemplateOpen(true)}
                >
                  <LayoutTemplate className="h-4 w-4 mr-1" />
                  {t("useTemplate")}
                </Button>
              </div>

              {templateId && templateLoading && (
                <div className="flex items-center gap-2 text-muted-foreground mb-6">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("loadingTemplate")}
                </div>
              )}

              {templateId && templateError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 mb-6">
                  <p className="text-sm text-destructive">
                    {t.rich("browseTemplatesInstead", {
                      error: templateError,
                      link: (chunks) => (
                        <Link href="/dashboard/templates" className="underline">
                          {chunks}
                        </Link>
                      ),
                    })}
                  </p>
                </div>
              )}

              {isCreateTemplate && !templateId && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm text-muted-foreground mb-6">
                  <CopyPlus className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                  <span>
                    {t.rich("buildingTemplateNotice", {
                      strong: (chunks) => <strong>{chunks}</strong>,
                    })}
                  </span>
                </div>
              )}

              {templateId && templatePrefill && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm text-muted-foreground mb-6">
                  <CopyPlus className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                  <span>
                    {t.rich("prefilledFromTemplate", {
                      name: templatePrefill.name,
                      strong: (chunks) => <strong>{chunks}</strong>,
                    })}
                  </span>
                </div>
              )}

              {templateLoading ? (
                <div className="space-y-4">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-12 rounded-lg bg-muted/40 animate-pulse" />
                  ))}
                </div>
              ) : (
                <>
                  {type === "rotational" && (
                    <RotationalForm key={templateId ?? "default"} prefill={prefill} />
                  )}
                  {type === "target" && (
                    <TargetForm key={templateId ?? "default"} prefill={prefill} />
                  )}
                  {type === "flexible" && (
                    <FlexibleForm key={templateId ?? "default"} prefill={prefill} />
                  )}
                </>
              )}
            </Card>
          </div>
        </main>

        <UseTemplateDialog
          open={useTemplateOpen}
          onOpenChange={setUseTemplateOpen}
          poolType={type as "rotational" | "target" | "flexible"}
          address={address}
        />
      </div>
    </ErrorBoundary>
  )
}
