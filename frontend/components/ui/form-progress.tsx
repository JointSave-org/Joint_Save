"use client"

import { CheckCircle2, Circle } from "lucide-react"
import { Progress } from "@/components/ui/progress"

export interface ProgressField {
  label: string
  valid: boolean
}

interface FormProgressProps {
  fields: ProgressField[]
  className?: string
}

export function FormProgress({ fields, className }: FormProgressProps) {
  const completed = fields.filter((f) => f.valid).length
  const total = fields.length
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100)

  return (
    <div className={`space-y-3 p-4 rounded-lg bg-muted/30 border border-border ${className ?? ""}`}>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Form completion</span>
        <span className="text-muted-foreground tabular-nums">{completed}/{total} fields</span>
      </div>
      <Progress value={pct} className="h-1.5" />
      <ul className="grid grid-cols-2 gap-1">
        {fields.map((field) => (
          <li key={field.label} className="flex items-center gap-1.5 text-xs">
            {field.valid ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
            ) : (
              <Circle className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            )}
            <span className={field.valid ? "text-foreground" : "text-muted-foreground"}>
              {field.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
