import { Hero } from "@/components/landing/hero"
import { Features } from "@/components/landing/features"
import { HowItWorks } from "@/components/landing/how-it-works"
import { Security } from "@/components/landing/security"
import { CTA } from "@/components/landing/cta"
import { Header } from "@/components/landing/header"
import { Footer } from "@/components/landing/footer"
import { BackToTop } from "@/components/ui/back-to-top"

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Security />
        <CTA />
      </main>
      <Footer />
      <BackToTop />
    </div>
  )
}