"use client"

import { Card } from "@/components/ui/card"
import { Users, Target, Zap, Shield, TrendingUp, Clock } from "lucide-react"
import { motion } from "framer-motion"

const features = [
  {
    icon: Users,
    title: "Rotational Savings",
    description:
      "Traditional savings circle onchain. Members take turns receiving the full pool payout automatically.",
  },
  {
    icon: Target,
    title: "Target Pool",
    description:
      "Save together toward a shared goal. Funds unlock when the target amount is reached.",
  },
  {
    icon: Zap,
    title: "Flexible Pool",
    description:
      "Deposit and withdraw anytime with optional yield generation through Stellar DeFi.",
  },
  {
    icon: Shield,
    title: "Smart Contract Escrow",
    description:
      "Every group is governed by a Soroban smart contract. No middlemen, no trust issues.",
  },
  {
    icon: TrendingUp,
    title: "Yield Integration",
    description:
      "Idle funds can earn passive income for members through Stellar ecosystem protocols.",
  },
  {
    icon: Clock,
    title: "Auto Enforcement",
    description:
      "Late deposits are flagged automatically. Missed rounds result in removal from cycles.",
  },
]

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } },
}

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
}

export function Features() {
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
            Everything you need for <span className="text-primary">community savings</span>
          </h2>
          <p className="text-lg text-muted-foreground text-pretty">
            Built for communities worldwide, powered by Stellar blockchain technology
          </p>
        </motion.div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8"
        >
          {features.map((feature, index) => (
            <motion.div key={index} variants={item}>
              <Card className="p-6 h-full hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 hover:-translate-y-1 border-border/50">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 mb-4">
                  <feature.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                <p className="text-muted-foreground text-pretty">{feature.description}</p>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
