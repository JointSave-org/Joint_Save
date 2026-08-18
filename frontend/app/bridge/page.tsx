import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { ArrowRight, ExternalLink, Info, Wallet, ArrowLeftRight, CheckCircle2 } from "lucide-react"

export const metadata: Metadata = {
  title: "Bridge USDC to Stellar — JointSave",
  description:
    "Step-by-step guide to bringing USDC from Ethereum, Base, or Solana onto Stellar so you can deposit into a JointSave pool.",
}

const cctpSteps = [
  {
    title: "Open a CCTP-enabled bridge",
    body: "Circle's Cross-Chain Transfer Protocol (CCTP) burns USDC on the source chain and mints native USDC on Stellar — no wrapped assets, no extra gas token needed on the destination side. Use a CCTP-enabled interface such as Circle's own bridge, Allbridge, or Portal.",
  },
  {
    title: "Connect your source-chain wallet",
    body: "Connect the wallet holding your USDC on Ethereum, Base, Avalanche, or another CCTP-supported chain. Select Stellar as the destination network.",
  },
  {
    title: "Enter your Stellar address",
    body: "Paste the Stellar (G…) address you use with JointSave as the recipient. Double-check it — Stellar transfers to accounts without the right trustline or memo can be unrecoverable, so most bridge UIs will warn you if something looks off.",
  },
  {
    title: "Confirm the burn-and-mint",
    body: "Approve the transaction on the source chain. CCTP burns your USDC there and, once Circle's attestation confirms, mints the equivalent amount of native USDC directly into your Stellar account. This typically takes a few minutes.",
  },
  {
    title: "Deposit into your pool",
    body: "Once the USDC lands in your Stellar wallet, open your JointSave pool and deposit as usual — the deposit form shows your live USDC balance and the correct token contract is used automatically.",
  },
]

const stellarUsdcSteps = [
  {
    title: "Already hold USDC via a centralized exchange?",
    body: 'Many exchanges (Coinbase, Kraken, and others) support withdrawing USDC directly on the Stellar network. Choose "Stellar" as the withdrawal network and send to your JointSave wallet\'s G… address.',
  },
  {
    title: "Add a USDC trustline",
    body: 'Stellar accounts must "trust" an asset before they can hold it. Most modern Stellar wallets (Freighter, Lobstr, xBull) prompt you to add the USDC trustline automatically the first time you receive it — if not, add it manually from your wallet\'s assets screen.',
  },
  {
    title: "Verify on Stellar Expert",
    body: "Use Stellar Expert to confirm the incoming USDC transaction and that your balance reflects the official Circle-issued USDC asset, not a look-alike.",
  },
]

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
  return (
    <div className="min-h-screen bg-background">
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-lg">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl">
                <Image
                  src="/joint-save.jpg"
                  alt="JointSave Logo"
                  width={40}
                  height={40}
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
          Bridge Guide
        </Badge>
        <h1 className="mb-4 text-4xl font-bold tracking-tight text-balance sm:text-5xl">
          Bridge USDC to Stellar
        </h1>
        <p className="mb-8 max-w-2xl text-lg text-muted-foreground text-pretty">
          JointSave pools accept native USDC on Stellar as a deposit currency alongside XLM. If your
          USDC lives on Ethereum, Base, Solana, or another chain, here&apos;s how to bring it over
          before depositing.
        </p>

        <Alert className="mb-10">
          <Info className="h-4 w-4" />
          <AlertTitle>This page is educational only</AlertTitle>
          <AlertDescription>
            JointSave does not custody funds during a bridge transfer or operate a bridge itself.
            Bridging happens entirely on the external services linked below — always verify URLs and
            double-check recipient addresses before sending funds.
          </AlertDescription>
        </Alert>

        <div className="space-y-10">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <ArrowLeftRight className="h-5 w-5 text-primary" />
                Option A: Circle&apos;s Cross-Chain Transfer Protocol (CCTP)
              </CardTitle>
              <CardDescription>
                The recommended path for USDC held on Ethereum, Base, Avalanche, and other
                CCTP-supported chains.
              </CardDescription>
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
                  Circle CCTP <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Wallet className="h-5 w-5 text-primary" />
                Option B: Stellar&apos;s native USDC
              </CardTitle>
              <CardDescription>
                If you already hold USDC on a centralized exchange, you can often withdraw directly
                to Stellar without bridging at all.
              </CardDescription>
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
                  Stellar Expert <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                After bridging
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground leading-relaxed space-y-2">
              <p>
                Once USDC shows up in your Stellar wallet, head back to your pool. The deposit form
                on any USDC-denominated pool automatically reads your live USDC balance and builds
                the transaction against the correct token contract — no extra configuration needed.
              </p>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 font-medium text-primary hover:underline"
              >
                Go to your dashboard <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
