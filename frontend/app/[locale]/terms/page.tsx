import { useTranslations } from "next-intl"
import Image from "next/image"
import { Link } from "@/i18n/navigation"
import { ThemeToggle } from "@/components/ui/theme-toggle"

export default function TermsOfService() {
  const t = useTranslations("legal")
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
                  blurDataURL="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MCA0MCI+PHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjMWUxZTJlIi8+PC9zdmc+"
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
            {t("comingSoon")}
          </p>
          <h1 className="mb-6 text-5xl font-bold tracking-tight text-balance sm:text-6xl">
            {t("termsTitle")}
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-xl text-muted-foreground text-pretty">
            {t("termsBody")}
          </p>
          <Link href="/" className="text-primary hover:underline">
            {t("backToHome")}
          </Link>
        </section>
      </main>
    </div>
  )
}
