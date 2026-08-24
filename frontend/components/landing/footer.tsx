import { getTranslations } from "next-intl/server"
import Image from "next/image"
import { Twitter, Github, MessageCircle } from "lucide-react"
import { Link } from "@/i18n/navigation"

export async function Footer() {
  const t = await getTranslations("landing.footer")

  return (
    <footer className="border-t border-border/40 py-12">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div className="col-span-1 md:col-span-2">
            <Link href="/" className="flex items-center gap-2 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl overflow-hidden">
                <Image
                  src="/joint-save.webp"
                  alt="JointSave Logo"
                  width={40}
                  height={40}
                  placeholder="blur"
                  blurDataURL="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MCA0MCI+PHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjMWUxZTJlIi8+PC9zdmc+"
                  className="object-cover"
                />
              </div>
              <span className="text-xl font-bold">JointSave</span>
            </Link>
            <p className="text-muted-foreground max-w-md text-pretty">{t("tagline")}</p>
          </div>

          <div>
            <h3 className="font-semibold mb-4">{t("product")}</h3>
            <ul className="space-y-2">
              <li>
                <Link
                  href="#features"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("features")}
                </Link>
              </li>
              <li>
                <Link
                  href="#how-it-works"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("howItWorks")}
                </Link>
              </li>
              <li>
                <Link
                  href="#security"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("security")}
                </Link>
              </li>
              <li>
                <Link
                  href="/bridge"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  {t("bridge")}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-semibold mb-4">{t("community")}</h3>
            <ul className="space-y-2">
              <li>
                <span
                  className="text-muted-foreground/50 cursor-not-allowed flex items-center gap-2"
                  aria-disabled="true"
                  title={t("comingSoon")}
                >
                  <Twitter className="h-4 w-4" />
                  {t("twitterComingSoon")}
                </span>
              </li>
              <li>
                <span
                  className="text-muted-foreground/50 cursor-not-allowed flex items-center gap-2"
                  aria-disabled="true"
                  title={t("comingSoon")}
                >
                  <MessageCircle className="h-4 w-4" />
                  {t("discordComingSoon")}
                </span>
              </li>
              <li>
                <a
                  href="https://github.com/JointSave-org/Joint_Save"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2"
                >
                  <Github className="h-4 w-4" />
                  {t("github")}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-border/40 pt-8 flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted-foreground">{t("copyright")}</p>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground transition-colors">
              {t("privacyPolicy")}
            </Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">
              {t("termsOfService")}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
