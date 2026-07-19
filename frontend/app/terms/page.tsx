import Image from "next/image"
import Link from "next/link"
import { ThemeToggle } from "@/components/ui/theme-toggle"

export default function TermsOfService() {
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
      <main className="container mx-auto flex min-h-screen items-center justify-center px-4 pt-16 sm:px-6 lg:px-8">
        <section className="mx-auto max-w-3xl py-24 text-center">
          <p className="mb-4 text-sm font-semibold uppercase tracking-wider text-primary">
            Coming Soon
          </p>
          <h1 className="mb-6 text-5xl font-bold tracking-tight text-balance sm:text-6xl">
            Terms of Service
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-xl text-muted-foreground text-pretty">
            We&apos;re finalizing our Terms of Service. Check back soon, or reach out if you have
            questions in the meantime.
          </p>
          <Link href="/" className="text-primary hover:underline">
            Back to Home
          </Link>
        </section>
      </main>
    </div>
  )
}