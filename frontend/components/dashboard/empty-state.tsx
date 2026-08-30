"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Users, Target, Zap, PiggyBank } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { motion } from "framer-motion"
import { useTranslations } from "next-intl"

const POOL_TYPE_ICONS = { rotational: Users, target: Target, flexible: Zap } as const
const POOL_TYPE_KEYS = ["rotational", "target", "flexible"] as const

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } },
}

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
}

interface EmptyStateProps {
  onCreateClick?: () => void
}

export function EmptyState({ onCreateClick }: EmptyStateProps) {
  const t = useTranslations("dashboard.emptyState")

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
      className="space-y-8"
    >
      {/* Hero section */}
      <div className="text-center py-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 mx-auto mb-4">
          <PiggyBank className="h-10 w-10 text-primary" aria-hidden="true" />
        </div>
        <h3 className="text-2xl font-bold mb-2">{t("heading")}</h3>
        <p className="text-muted-foreground max-w-md mx-auto">{t("subheading")}</p>
      </div>

      {/* Pool type cards */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 sm:grid-cols-3 gap-4"
      >
        {POOL_TYPE_KEYS.map((type) => {
          const Icon = POOL_TYPE_ICONS[type]
          const title = t(`types.${type}.title`)
          return (
            <motion.div
              key={type}
              variants={item}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Card className="p-5 h-full flex flex-col hover:shadow-lg hover:shadow-primary/5 transition-all duration-300">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 mb-3">
                  <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
                </div>
                <h4 className="text-base font-semibold mb-1">{title}</h4>
                <p className="text-sm text-muted-foreground mb-4 flex-1">
                  {t(`types.${type}.description`)}
                </p>
                <Button
                  className="w-full bg-primary hover:bg-primary/90"
                  asChild
                  onClick={onCreateClick}
                >
                  <Link href={`/dashboard/create/${type}`}>{t("create", { title })}</Link>
                </Button>
              </Card>
            </motion.div>
          )
        })}
      </motion.div>

      {/* Learn more link */}
      <p className="text-center text-sm text-muted-foreground">
        {t("notSurePrefix")}{" "}
        <Link
          href="/#how-it-works"
          className="text-primary underline-offset-4 hover:underline font-medium"
        >
          {t("learnHowItWorks")}
        </Link>
      </p>
    </motion.div>
  )
}
