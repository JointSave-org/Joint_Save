"use client"

import { Button } from "@/components/ui/button"
import { ArrowRight } from "lucide-react"
import { useStellar } from "@/components/web3-provider"
import Link from "next/link"

export function CTA() {
  const { connect, isConnected } = useStellar()

  return (
    <section className="py-20 sm:py-32">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary/20 via-primary/10 to-accent/20 p-12 sm:p-16 lg:p-20 border border-primary/20">
          <div className="absolute inset-0 -z-10">
            <div className="absolute top-0 right-0 w-96 h-96 bg-primary/30 rounded-full blur-3xl animate-glow" />
            <div
              className="absolute bottom-0 left-0 w-96 h-96 bg-accent/30 rounded-full blur-3xl animate-glow"
              style={{ animationDelay: "1.5s" }}
            />
          </div>

          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-6 text-balance">
              Ready to start saving with your community?
            </h2>
            <p className="text-lg text-muted-foreground mb-8 text-pretty">
              Join communities worldwide building financial trust onchain with Stellar
            </p>
            {isConnected ? (
              <Button
                size="lg"
                className="bg-primary hover:bg-primary/90 text-lg px-8 h-14"
                asChild
              >
                <Link href="/dashboard">
                  Launch App
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
            ) : (
              <Button
                size="lg"
                className="bg-primary hover:bg-primary/90 text-lg px-8 h-14"
                onClick={connect}
              >
                Connect Wallet
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
