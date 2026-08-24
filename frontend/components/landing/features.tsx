"use client"

import { useTranslations } from "next-intl"
import { Card } from "@/components/ui/card"
import { Users, Target, Zap, Shield, TrendingUp, Clock } from "lucide-react"
import { motion } from "framer-motion"

const FEATURE_ICONS = [Users, Target, Zap, Shield, TrendingUp, Clock] as const
const FEATURE_KEYS = [
  "rotational",
  "target",
  "flexible",
  "escrow",
  "yield",
  "enforcement",
] as const

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } },
}

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
}

export function Features() {
  const t = useTranslations("landing.features")

  return (
    <section id="features" className="py-20 sm:py-32">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="max-w-2xl mx-auto text-center mb-16"
        >
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4 text-balance">
            {t.rich("title", {
              highlight: (chunks) => <span className="text-primary">{chunks}</span>,
            })}
          </h2>
          <p className="text-lg text-muted-foreground text-pretty">{t("subtitle")}</p>
        </motion.div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8"
        >
          {FEATURE_KEYS.map((key, index) => {
            const Icon = FEATURE_ICONS[index]
            return (
              <motion.div key={key} variants={item}>
                <Card className="p-6 h-full hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1 border-border/50">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 mb-4">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="text-xl font-semibold mb-2">{t(`items.${key}.title`)}</h3>
                  <p className="text-muted-foreground text-pretty">
                    {t(`items.${key}.description`)}
                  </p>
                </Card>
              </motion.div>
            )
          })}
        </motion.div>
      </div>
    </section>
  )
}
