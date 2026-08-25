"use client"

import Image from "next/image"
import { useTranslations } from "next-intl"
import { Link } from "@/i18n/navigation"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ArrowRight, ExternalLink, Info, Wallet, ArrowLeftRight, CheckCircle2 } from "lucide-react"

function StepList({ steps }: { steps: { title: string; body: string }[] }) {
  return (
    <ol className="space-y-4">
      {steps.map((step, i) => (
        <li key={step.title} className="flex gap-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
            {i + 1}
          </span>
          <div>
            <p className="font-medium leading-snug">{step.title}</p>
            <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

export default function BridgePage() {
  const t = useTranslations("bridge")

  const cctpSteps = [
    { title: t("cctp.step1Title"), body: t("cctp.step1Body") },
    { title: t("cctp.step2Title"), body: t("cctp.step2Body") },
    { title: t("cctp.step3Title"), body: t("cctp.step3Body") },
    { title: t("cctp.step4Title"), body: t("cctp.step4Body") },
    { title: t("cctp.step5Title"), body: t("cctp.step5Body") },
  ]

  const stellarUsdcSteps = [
    { title: t("stellarUsdc.step1Title"), body: t("stellarUsdc.step1Body") },
    { title: t("stellarUsdc.step2Title"), body: t("stellarUsdc.step2Body") },
    { title: t("stellarUsdc.step3Title"), body: t("stellarUsdc.step3Body") },
  ]

  return (
    <div className="min-h-screen bg-background">
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-lg">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl">
                <Image
                  src="/joint-save.webp"
                  alt="JointSave Logo"
                  width={40}
                  height={40}
                  priority
                  placeholder="blur"
                  blurDataURL="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA4MCA4MCI+PHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjgwIiBmaWxsPSIjMWUxZTJlIi8+PC9zdmc+"
                  className="object-cover"
                />
              </div>
              <span className="text-xl font-bold">JointSave</span>
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-4 pt-28 pb-24 sm:px-6 lg:px-8">
        <Badge variant="secondary" className="mb-4 gap-1.5">
          <ArrowLeftRight className="h-3.5 w-3.5" />
          {t("badge")}
        </Badge>
        <h1 className="mb-4 text-4xl font-bold tracking-tight text-balance sm:text-5xl">
          {t("title")}
        </h1>
        <p className="mb-8 max-w-2xl text-lg text-muted-foreground text-pretty">
          {t("description")}
        </p>

        <Alert className="mb-10">
          <Info className="h-4 w-4" />
          <AlertTitle>{t("educationalTitle")}</AlertTitle>
          <AlertDescription>{t("educationalBody")}</AlertDescription>
        </Alert>

        <div className="space-y-10">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <ArrowLeftRight className="h-5 w-5 text-primary" />
                {t("cctp.title")}
              </CardTitle>
              <CardDescription>{t("cctp.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <StepList steps={cctpSteps} />
              <div className="mt-6 flex flex-wrap gap-3">
                <a
                  href="https://www.circle.com/cross-chain-transfer-protocol"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  {t("cctp.linkLabel")} <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Wallet className="h-5 w-5 text-primary" />
                {t("stellarUsdc.title")}
              </CardTitle>
              <CardDescription>{t("stellarUsdc.description")}</CardDescription>
            </CardHeader>
            <CardContent>
              <StepList steps={stellarUsdcSteps} />
              <div className="mt-6 flex flex-wrap gap-3">
                <a
                  href="https://stellar.expert/explorer/testnet"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                >
                  {t("stellarUsdc.linkLabel")} <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                {t("afterBridging.title")}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground leading-relaxed space-y-2">
              <p>{t("afterBridging.body")}</p>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
              >
                {t("afterBridging.dashboardLink")} <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
