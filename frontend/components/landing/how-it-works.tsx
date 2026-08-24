"use client"

import { useTranslations } from "next-intl"
import { Card } from "@/components/ui/card"
import { motion } from "framer-motion"

const STEP_KEYS = ["connect", "createOrJoin", "contribute", "payout"] as const

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.15 } },
}

const item = {
  hidden: { opacity: 0, x: -20 },
  show: { opacity: 1, x: 0 },
}

export function HowItWorks() {
  const t = useTranslations("landing.howItWorks")

  return (
    <section id="how-it-works" className="py-20 sm:py-32 bg-muted/30">
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
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8"
        >
          {STEP_KEYS.map((key, index) => {
            const number = String(index + 1).padStart(2, "0")
            return (
              <motion.div key={key} variants={item}>
                <Card className="p-6 h-full relative overflow-hidden border-border/50">
                  <div className="absolute top-0 right-0 text-8xl font-bold text-primary/5 -mr-4 -mt-4">
                    {number}
                  </div>
                  <div className="relative">
                    <div className="text-4xl font-bold text-primary mb-4">{number}</div>
                    <h3 className="text-xl font-semibold mb-2">{t(`steps.${key}.title`)}</h3>
                    <p className="text-muted-foreground text-pretty">
                      {t(`steps.${key}.description`)}
                    </p>
                  </div>
                </Card>
              </motion.div>
            )
          })}
        </motion.div>
      </div>
    </section>
  )
}
