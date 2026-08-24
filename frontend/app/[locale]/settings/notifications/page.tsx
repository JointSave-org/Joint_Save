"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { useStellar } from "@/components/web3-provider"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { useToast } from "@/hooks/use-toast"
import { validateEmail } from "@/lib/form-validation"
import { Loader2 } from "lucide-react"

type Frequency = "daily" | "weekly" | "off"

export default function NotificationSettingsPage() {
  const t = useTranslations("settings.notifications")
  const tv = useTranslations("pool.create.validation")
  const { address } = useStellar()
  const { toast } = useToast()

  const [email, setEmail] = useState("")
  const [frequency, setFrequency] = useState<Frequency>("off")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [emailError, setEmailError] = useState("")

  useEffect(() => {
    if (!address) return
    setLoading(true)
    fetch(`/api/notifications/digest-preferences?wallet=${address}`, {
      headers: { "x-wallet-address": address },
    })
      .then((res) => res.json())
      .then((data) => {
        setEmail(data.email ?? "")
        setFrequency((data.frequency as Frequency) ?? "off")
      })
      .catch(() => {
        toast({ title: t("couldNotLoadPreferences"), variant: "destructive" })
      })
      .finally(() => setLoading(false))
  }, [address])

  const handleSave = async () => {
    const check = validateEmail(email, {
      emailRequired: tv("emailRequired"),
      emailInvalid: tv("emailInvalid"),
    })
    if (!check.valid) {
      setEmailError(check.message)
      return
    }
    setEmailError("")
    setSaving(true)

    try {
      const res = await fetch("/api/notifications/digest-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-wallet-address": address },
        body: JSON.stringify({ wallet_address: address, email, frequency }),
      })
      if (!res.ok) throw new Error()
      toast({ title: t("preferencesSaved") })
    } catch {
      toast({ title: t("couldNotSavePreferences"), variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  if (!address) {
    return (
      <>
        <DashboardHeader />
        <div className="container mx-auto px-4 py-12 text-center text-muted-foreground">
          {t("connectWalletNotice")}
        </div>
      </>
    )
  }

  return (
    <>
      <DashboardHeader />
      <div className="container mx-auto max-w-2xl px-4 py-10">
        <h1 className="mb-6 text-2xl font-bold">{t("pageTitle")}</h1>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t("delivery")}</CardTitle>
                <CardDescription>{t("deliveryDescription")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="digest-email">{t("emailAddress")}</Label>
                  <Input
                    id="digest-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                  {emailError && <p className="text-sm text-destructive">{emailError}</p>}
                </div>

                <div className="space-y-2">
                  <Label>{t("frequency")}</Label>
                  <RadioGroup
                    value={frequency}
                    onValueChange={(v) => setFrequency(v as Frequency)}
                    className="gap-3"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="daily" id="freq-daily" />
                      <Label htmlFor="freq-daily" className="font-normal">
                        {t("frequencyDaily")}
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="weekly" id="freq-weekly" />
                      <Label htmlFor="freq-weekly" className="font-normal">
                        {t("frequencyWeekly")}
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="off" id="freq-off" />
                      <Label htmlFor="freq-off" className="font-normal">
                        {t("frequencyOff")}
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                <Button onClick={handleSave} disabled={saving}>
                  {saving ? t("saving") : t("savePreferences")}
                </Button>
              </CardContent>
            </Card>

            {frequency !== "off" && (
              <Card>
                <CardHeader>
                  <CardTitle>{t("preview")}</CardTitle>
                  <CardDescription>
                    {t("previewDescription", {
                      frequency:
                        frequency === "daily" ? t("frequencyDailyWord") : t("frequencyWeeklyWord"),
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
                    <p className="mb-2 font-semibold text-primary">JointSave</p>
                    <p className="mb-3 text-muted-foreground">
                      {t("digestSummary", {
                        frequency:
                          frequency === "daily"
                            ? t("frequencyDailyWord")
                            : t("frequencyWeeklyWord"),
                        period: frequency === "daily" ? t("last24Hours") : t("last7Days"),
                      })}
                    </p>
                    <ul className="space-y-2">
                      <li>
                        <span className="font-medium text-primary">
                          {t("depositConfirmationTitle")}
                        </span>
                        <br />
                        <span className="text-muted-foreground">
                          {t("depositConfirmationSample")}
                        </span>
                      </li>
                      <li>
                        <span className="font-medium text-primary">
                          {t("deadlineReminderTitle")}
                        </span>
                        <br />
                        <span className="text-muted-foreground">{t("deadlineReminderSample")}</span>
                      </li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  )
}
