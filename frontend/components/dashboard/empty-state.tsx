"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Users, Target, Zap, PiggyBank } from "lucide-react"
import Link from "next/link"
import { motion } from "framer-motion"

const poolTypes = [
  {
    type: "rotational",
    icon: Users,
    title: "Rotational",
    description: "Members take turns receiving the full pool payout on a fixed schedule.",
  },
  {
    type: "target",
    icon: Target,
    title: "Target Pool",
    description: "Save together toward a shared goal — funds unlock when the target is reached.",
  },
  {
    type: "flexible",
    icon: Zap,
    title: "Flexible Pool",
    description: "Deposit anytime with optional yield distribution and no rigid schedule.",
  },
]

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
        <h3 className="text-2xl font-bold mb-2">Start your first savings pool</h3>
        <p className="text-muted-foreground max-w-md mx-auto">
          Choose a savings model that fits your group. Each pool is governed by a Soroban smart
          contract for full transparency.
        </p>
      </div>

      {/* Pool type cards */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 sm:grid-cols-3 gap-4"
      >
        {poolTypes.map(({ type, icon: Icon, title, description }) => (
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
              <p className="text-sm text-muted-foreground mb-4 flex-1">{description}</p>
              <Button
                className="w-full bg-primary hover:bg-primary/90"
                asChild
                onClick={onCreateClick}
              >
                <Link href={`/dashboard/create/${type}`}>Create {title}</Link>
              </Button>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      {/* Learn more link */}
      <p className="text-center text-sm text-muted-foreground">
        Not sure which to pick?{" "}
        <Link
          href="/#how-it-works"
          className="text-primary underline-offset-4 hover:underline font-medium"
        >
          Learn how JointSave works
        </Link>
      </p>
    </motion.div>
  )
}
