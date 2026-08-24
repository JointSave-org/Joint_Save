"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Link } from "@/i18n/navigation"
import Image from "next/image"
import { useStellar } from "@/components/web3-provider"
import { ThemeToggle } from "@/components/ui/theme-toggle"
import { LanguageSwitcher } from "@/components/shared/language-switcher"
import { useToast } from "@/hooks/use-toast"
import { Copy, Check, ExternalLink, LogOut, ChevronDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function Header() {
  const t = useTranslations("nav")
  const { address, walletId, connect, disconnect } = useStellar()
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)

  const truncatedAddress = address ? `${address.slice(0, 4)}...${address.slice(-4)}` : ""

  const explorerUrl =
    address && walletId
      ? `https://stellar.expert/explorer/testnet/account/${address}?tab=operations&network=${walletId}`
      : address
        ? `https://stellar.expert/explorer/testnet/account/${address}`
        : "#"

  const handleDisconnect = () => {
    disconnect()
    window.location.href = "/"
  }

  const handleCopyAddress = async () => {
    if (!address) return
    await navigator.clipboard.writeText(address)
    setCopied(true)
    toast({ title: t("wallet.addressCopiedTitle"), description: t("wallet.addressCopiedDescription") })
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-lg">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl overflow-hidden">
              <Image
                src="/joint-save.webp"
                alt="JointSave Logo"
                width={40}
                height={40}
                priority
                placeholder="blur"
                blurDataURL="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MCA0MCI+PHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjMWUxZTJlIi8+PC9zdmc+"
                className="object-cover"
              />
            </div>
            <span className="text-xl font-bold">JointSave</span>
          </Link>

          <nav className="hidden md:flex items-center gap-8">
            <Link
              href="/explore"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("explore")}
            </Link>
            <Link
              href="#features"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("features")}
            </Link>
            <Link
              href="#how-it-works"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("howItWorks")}
            </Link>
            <Link
              href="#security"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("security")}
            </Link>
          </nav>

          <div className="flex items-center gap-4">
            <LanguageSwitcher />
            <ThemeToggle />
            {address ? (
              <>
                <Button variant="ghost" asChild className="hidden sm:flex">
                  <Link href="/dashboard">{t("dashboard")}</Link>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="gap-2">
                      <span>{truncatedAddress}</span>
                      <ChevronDown className="h-4 w-4 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem className="cursor-default font-mono text-xs">
                      {address}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleCopyAddress}>
                      {copied ? (
                        <Check className="mr-2 h-4 w-4" />
                      ) : (
                        <Copy className="mr-2 h-4 w-4" />
                      )}
                      {copied ? t("wallet.copied") : t("wallet.copyAddress")}
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a
                        href={explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-full cursor-pointer items-center"
                      >
                        <ExternalLink className="mr-2 h-4 w-4" />
                        {t("wallet.viewOnExplorer")}
                      </a>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleDisconnect} variant="destructive">
                      <LogOut className="mr-2 h-4 w-4" />
                      {t("wallet.disconnectWallet")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <Button onClick={connect} className="bg-primary hover:bg-primary/90">
                {t("connectWallet")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  )
}
