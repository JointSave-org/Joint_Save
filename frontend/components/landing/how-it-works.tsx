"use client"

import { Card } from "@/components/ui/card"
import { motion } from "framer-motion"

const steps = [
  {
    number: "01",
    title: "Connect Your Wallet",
    description:
      "Link your Stellar wallet (Freighter or any supported wallet) to get started in seconds.",
  },
  {
    number: "02",
    title: "Create or Join a Group",
    description:
      "Start a new savings circle or join an existing one. Choose rotational, target, or flexible mode.",
  },
  {
    number: "03",
    title: "Make Contributions",
    description:
      "Deposit funds according to your group schedule. Soroban smart contracts handle everything automatically.",
  },
  {
    number: "04",
    title: "Receive Payouts",
    description:
      "Get your payout when it's your turn. Transparent, automated, and trustless on Stellar.",
  },
]

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.15 } },
}

const item = {
  hidden: { opacity: 0, x: -20 },
  show: { opacity: 1, x: 0 },
}

export function HowItWorks() {
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
            How <span className="text-primary">JointSave</span> works
          </h2>
          <p className="text-lg text-muted-foreground text-pretty">
            Get started in minutes with our simple four-step process
          </p>
        </motion.div>

        <motion.div
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8"
        >
          {steps.map((step, index) => (
            <motion.div key={index} variants={item}>
              <Card className="p-6 h-full relative overflow-hidden border-border/50">
                <div className="absolute top-0 right-0 text-8xl font-bold text-primary/5 -mr-4 -mt-4">
                  {step.number}
                </div>
                <div className="relative">
                  <div className="text-4xl font-bold text-primary mb-4">{step.number}</div>
                  <h3 className="text-xl font-semibold mb-2">{step.title}</h3>
                  <p className="text-muted-foreground text-pretty">{step.description}</p>
                </div>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
