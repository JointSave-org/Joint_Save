"use client"

import { useEffect, useState } from "react"
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
        toast({ title: "Couldn't load your preferences", variant: "destructive" })
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  const handleSave = async () => {
    const check = validateEmail(email)
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
      toast({ title: "Preferences saved" })
    } catch {
      toast({ title: "Couldn't save preferences", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  if (!address) {
    return (
      <>
        <DashboardHeader />
        <div className="container mx-auto px-4 py-12 text-center text-muted-foreground">
          Connect your wallet to manage email preferences.
        </div>
      </>
    )
  }

  return (
    <>
      <DashboardHeader />
      <div className="container mx-auto max-w-2xl px-4 py-10">
        <h1 className="mb-6 text-2xl font-bold">Email Digest Preferences</h1>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Delivery</CardTitle>
                <CardDescription>
                  Where and how often should we send your activity digest?
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="digest-email">Email address</Label>
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
                  <Label>Frequency</Label>
                  <RadioGroup
                    value={frequency}
                    onValueChange={(v) => setFrequency(v as Frequency)}
                    className="gap-3"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="daily" id="freq-daily" />
                      <Label htmlFor="freq-daily" className="font-normal">
                        Daily -- one summary every 24 hours
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="weekly" id="freq-weekly" />
                      <Label htmlFor="freq-weekly" className="font-normal">
                        Weekly -- one summary every Monday
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="off" id="freq-off" />
                      <Label htmlFor="freq-off" className="font-normal">
                        Off -- no digest emails
                      </Label>
                    </div>
                  </RadioGroup>
                </div>

                <Button onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : "Save Preferences"}
                </Button>
              </CardContent>
            </Card>

            {frequency !== "off" && (
              <Card>
                <CardHeader>
                  <CardTitle>Preview</CardTitle>
                  <CardDescription>
                    A sample of what your {frequency} digest email will look like.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
                    <p className="mb-2 font-semibold text-primary">JointSave</p>
                    <p className="mb-3 text-muted-foreground">
                      Your {frequency} digest -- summary of{" "}
                      {frequency === "daily" ? "the last 24 hours" : "the last 7 days"}
                    </p>
                    <ul className="space-y-2">
                      <li>
                        <span className="font-medium text-primary">Deposit Confirmation</span>
                        <br />
                        <span className="text-muted-foreground">
                          Your deposit to &quot;Family Savings&quot; was confirmed.
                        </span>
                      </li>
                      <li>
                        <span className="font-medium text-primary">Deadline Reminder</span>
                        <br />
                        <span className="text-muted-foreground">
                          Round deadline for &quot;Family Savings&quot; is in 2 days.
                        </span>
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
