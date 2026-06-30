"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Users, Target, Zap } from "lucide-react"
import Link from "next/link"
import { motion } from "framer-motion"

const groupTypes = [
  {
    type: "rotational",
    icon: Users,
    title: "Rotational Savings",
    description:
      "Traditional savings circle onchain. Members take turns receiving payouts automatically.",
    features: ["Fixed contribution amount", "Scheduled payouts", "Turn-based system"],
  },
  {
    type: "target",
    icon: Target,
    title: "Target Pool",
    description: "Save together toward a shared goal. Funds unlock when the target is reached.",
    features: ["Shared savings goal", "Locked until target", "Equal distribution"],
  },
  {
    type: "flexible",
    icon: Zap,
    title: "Flexible Pool",
    description: "Deposit and withdraw anytime with optional yield generation.",
    features: ["Flexible deposits", "Anytime withdrawal", "Optional yield"],
  },
]

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
  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h2 className="text-3xl font-bold">Create a Savings Group</h2>
        <p className="text-muted-foreground mt-1">Choose a savings mode to get started</p>
      </motion.div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 md:grid-cols-3 gap-6"
      >
        {groupTypes.map((groupType) => (
          <motion.div
            key={groupType.type}
            variants={item}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            <Card className="p-6 h-full flex flex-col hover:shadow-lg hover:shadow-primary/5 transition-all duration-300">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 mb-4">
                <groupType.icon className="h-7 w-7 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">{groupType.title}</h3>
              <p className="text-muted-foreground mb-4 text-sm flex-1">{groupType.description}</p>

              <ul className="space-y-2 mb-6">
                {groupType.features.map((feature, index) => (
                  <li key={index} className="text-sm flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                    {feature}
                  </li>
                ))}
              </ul>

              <Button className="w-full bg-primary hover:bg-primary/90" asChild>
                <Link href={`/dashboard/create/${groupType.type}`}>Create {groupType.title}</Link>
              </Button>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
      >
        <Card className="p-6 bg-muted/30">
          <h3 className="text-lg font-semibold mb-2">Need help choosing?</h3>
          <p className="text-muted-foreground text-sm mb-4">
            Not sure which savings mode is right for you? Here's a quick guide:
          </p>
          <ul className="space-y-2 text-sm">
            <li className="flex gap-2">
              <span className="font-medium min-w-[120px]">Rotational:</span>
              <span className="text-muted-foreground">
                Best for regular income groups who want predictable payouts
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-medium min-w-[120px]">Target:</span>
              <span className="text-muted-foreground">
                Perfect for saving toward a specific goal like a wedding or business
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-medium min-w-[120px]">Flexible:</span>
              <span className="text-muted-foreground">
                Ideal for emergency funds or groups with varying income
              </span>
            </li>
          </ul>
        </Card>
      </motion.div>
    </div>
  )
}
