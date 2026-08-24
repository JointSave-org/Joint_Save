"use client"

import { useTranslations } from "next-intl"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Users, Target, Zap } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { motion } from "framer-motion"
import { ContextualHelp } from "@/components/onboarding/contextual-help"

const GROUP_TYPE_ICONS = { rotational: Users, target: Target, flexible: Zap } as const
const GROUP_TYPE_KEYS = ["rotational", "target", "flexible"] as const

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
    },
  },
}

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
}

export function CreateGroup() {
  const t = useTranslations("pool.create.intro")

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h2 className="text-3xl font-bold">{t("heading")}</h2>
        <p className="text-muted-foreground mt-1">{t("subheading")}</p>
      </motion.div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 md:grid-cols-3 gap-6"
      >
        {GROUP_TYPE_KEYS.map((type) => {
          const Icon = GROUP_TYPE_ICONS[type]
          const title = t(`types.${type}.title`)
          const description = t(`types.${type}.description`)
          const features = t.raw(`types.${type}.features`) as string[]
          return (
            <motion.div
              key={type}
              variants={item}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              <Card className="p-6 h-full flex flex-col hover:shadow-lg hover:shadow-primary/5 transition-all duration-300">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 mb-4">
                  <Icon className="h-7 w-7 text-primary" />
                </div>
                <div className="flex items-center gap-1.5 mb-2">
                  <h3 className="text-xl font-semibold">{title}</h3>
                  <ContextualHelp title={title} content={description} />
                </div>
                <p className="text-muted-foreground mb-4 text-sm flex-1">{description}</p>

                <ul className="space-y-2 mb-6">
                  {features.map((feature, index) => (
                    <li key={index} className="text-sm flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                      {feature}
                    </li>
                  ))}
                </ul>

                <Button className="w-full bg-primary hover:bg-primary/90" asChild>
                  <Link href={`/dashboard/create/${type}`}>{t("create", { title })}</Link>
                </Button>
              </Card>
            </motion.div>
          )
        })}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
      >
        <Card className="p-6 bg-muted/30">
          <h3 className="text-lg font-semibold mb-2">{t("helpTitle")}</h3>
          <p className="text-muted-foreground text-sm mb-4">{t("helpSubtitle")}</p>
          <ul className="space-y-2 text-sm">
            {GROUP_TYPE_KEYS.map((type) => (
              <li key={type} className="flex gap-2">
                <span className="font-medium min-w-[120px]">{t(`types.${type}.guideLabel`)}</span>
                <span className="text-muted-foreground">
                  {t(`types.${type}.guideDescription`)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </motion.div>
    </div>
  )
}
