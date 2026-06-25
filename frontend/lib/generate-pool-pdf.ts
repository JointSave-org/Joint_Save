/**
 * generate-pool-pdf.ts
 * Client-side pool summary PDF generator using jsPDF + jspdf-autotable.
 * All data is passed in; no network calls are made inside this module.
 */

import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PdfMember {
  member_address: string
  contribution_amount: number
  status: "pending" | "paid" | "late"
  joined_at?: string
}

export interface PdfActivity {
  activity_type: string
  user_address: string | null
  amount: number | null
  description: string | null
  created_at: string
  tx_hash: string | null
  source?: "onchain" | "offchain"
}

export interface PdfPoolData {
  // Core fields
  id: string
  name: string
  type: "rotational" | "target" | "flexible"
  status: string
  description: string | null
  created_at: string
  contract_address: string
  creator_address: string

  // Financial
  total_saved: number
  target_amount: number | null
  contribution_amount: number | null
  frequency: string | null
  deadline: string | null

  // Relations
  pool_members: PdfMember[]
  pool_activity: PdfActivity[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt = {
  date: (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    } catch {
      return iso
    }
  },
  datetime: (iso: string) => {
    try {
      return new Date(iso).toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    } catch {
      return iso
    }
  },
  xlm: (n: number | null) => (n != null ? `${n.toFixed(7)} XLM` : "—"),
  addr: (a: string | null) =>
    a ? `${a.slice(0, 8)}…${a.slice(-6)}` : "System",
  type: (t: string) => t.charAt(0).toUpperCase() + t.slice(1),
  actType: (t: string) =>
    ({
      deposit: "Deposit",
      payout: "Payout",
      withdraw: "Withdrawal",
      complete: "Pool Complete",
      member_joined: "Member Joined",
      pool_created: "Pool Created",
      yield: "Yield Distributed",
      refund: "Refund",
    }[t] ?? t),
}

// ── Colour palette (Stellar-themed) ──────────────────────────────────────────

const C = {
  primary: [100, 60, 200] as [number, number, number],   // indigo-violet
  accent: [50, 180, 150] as [number, number, number],    // teal
  dark: [20, 20, 35] as [number, number, number],
  mid: [80, 80, 110] as [number, number, number],
  light: [245, 244, 255] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  muted: [120, 118, 145] as [number, number, number],
  border: [220, 218, 235] as [number, number, number],
}

// ── Main export ───────────────────────────────────────────────────────────────

export function generatePoolPdf(pool: PdfPoolData): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  const PAGE_W = 210
  const MARGIN = 16
  const CONTENT_W = PAGE_W - MARGIN * 2

  let y = 0

  // ── Cover / header band ────────────────────────────────────────────────────

  // Background gradient bar
  doc.setFillColor(...C.primary)
  doc.rect(0, 0, PAGE_W, 52, "F")

  // Decorative accent strip
  doc.setFillColor(...C.accent)
  doc.rect(0, 52, PAGE_W, 4, "F")

  // Logo / brand text
  doc.setTextColor(...C.white)
  doc.setFontSize(10)
  doc.setFont("helvetica", "bold")
  doc.text("JointSave", MARGIN, 14)

  // Pool name
  doc.setFontSize(22)
  doc.text(pool.name, MARGIN, 28, { maxWidth: CONTENT_W - 30 })

  // Type + status badges (pill effect via rounded rect)
  const badgeY = 36
  const drawBadge = (label: string, x: number, bg: [number, number, number]) => {
    const w = doc.getTextWidth(label) + 8
    doc.setFillColor(...bg)
    doc.roundedRect(x, badgeY - 5, w, 7, 2, 2, "F")
    doc.setFontSize(8)
    doc.setTextColor(...C.white)
    doc.text(label, x + 4, badgeY)
    return x + w + 4
  }

  let bx = MARGIN
  bx = drawBadge(fmt.type(pool.type), bx, C.accent)
  drawBadge(fmt.type(pool.status), bx, [140, 100, 220])

  // Generated timestamp (top-right)
  doc.setFontSize(7.5)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(200, 195, 255)
  const genStr = `Generated ${fmt.datetime(new Date().toISOString())}`
  doc.text(genStr, PAGE_W - MARGIN, 12, { align: "right" })

  y = 64

  // ── Section helper ─────────────────────────────────────────────────────────

  const checkPage = (neededPx = 20) => {
    if (y + neededPx > 275) {
      doc.addPage()
      y = 16
    }
  }

  const sectionHeader = (title: string) => {
    checkPage(14)
    doc.setFillColor(...C.light)
    doc.rect(MARGIN, y - 1, CONTENT_W, 10, "F")
    doc.setDrawColor(...C.primary)
    doc.setLineWidth(0.7)
    doc.line(MARGIN, y - 1, MARGIN, y + 9)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(10)
    doc.setTextColor(...C.primary)
    doc.text(title.toUpperCase(), MARGIN + 4, y + 5.5)
    y += 14
  }

  const labelValue = (
    label: string,
    value: string,
    col2Start = MARGIN + 48
  ) => {
    checkPage(8)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(8.5)
    doc.setTextColor(...C.muted)
    doc.text(label, MARGIN, y)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(...C.dark)
    const lines = doc.splitTextToSize(value, CONTENT_W - 50)
    doc.text(lines, col2Start, y)
    y += lines.length * 5 + 2
  }

  // ── 1. Pool Overview ───────────────────────────────────────────────────────

  sectionHeader("Pool Overview")
  labelValue("Pool Type:", fmt.type(pool.type))
  labelValue("Status:", fmt.type(pool.status))
  labelValue("Created:", fmt.date(pool.created_at))
  if (pool.description) labelValue("Description:", pool.description)
  labelValue("Creator:", pool.creator_address)

  // Type-specific fields
  if (pool.type === "rotational") {
    if (pool.contribution_amount != null)
      labelValue("Round Contribution:", fmt.xlm(pool.contribution_amount))
    if (pool.frequency) labelValue("Frequency:", fmt.type(pool.frequency))
  } else if (pool.type === "target") {
    if (pool.target_amount != null)
      labelValue("Target Amount:", fmt.xlm(pool.target_amount))
    if (pool.deadline)
      labelValue("Deadline:", fmt.date(pool.deadline))
  } else if (pool.type === "flexible") {
    if (pool.contribution_amount != null)
      labelValue("Min. Deposit:", fmt.xlm(pool.contribution_amount))
  }

  labelValue("Total Collected:", fmt.xlm(pool.total_saved))

  y += 4

  // ── 2. On-Chain Verification ───────────────────────────────────────────────

  sectionHeader("On-Chain Verification")

  const isPending =
    !pool.contract_address || pool.contract_address === "pending_deployment"

  if (isPending) {
    doc.setFont("helvetica", "italic")
    doc.setFontSize(8.5)
    doc.setTextColor(...C.muted)
    doc.text("Contract not yet deployed.", MARGIN, y)
    y += 7
  } else {
    labelValue("Contract Address:", pool.contract_address)
    const explorerUrl = `https://stellar.expert/explorer/testnet/contract/${pool.contract_address}`
    labelValue("Stellar Expert:", explorerUrl)

    checkPage(14)
    doc.setFillColor(240, 248, 244)
    doc.roundedRect(MARGIN, y, CONTENT_W, 12, 2, 2, "F")
    doc.setFont("helvetica", "italic")
    doc.setFontSize(7.5)
    doc.setTextColor(...C.mid)
    doc.text(
      "The full on-chain transaction record can be independently verified via Stellar Expert using the contract address above.",
      MARGIN + 4,
      y + 7,
      { maxWidth: CONTENT_W - 8 }
    )
    y += 18
  }

  y += 4

  // ── 3. Members ─────────────────────────────────────────────────────────────

  sectionHeader(`Members (${pool.pool_members.length})`)

  if (pool.pool_members.length === 0) {
    doc.setFont("helvetica", "italic")
    doc.setFontSize(8.5)
    doc.setTextColor(...C.muted)
    doc.text("No members recorded.", MARGIN, y)
    y += 8
  } else {
    const memberRows = pool.pool_members.map((m, i) => [
      String(i + 1),
      m.member_address,
      fmt.xlm(m.contribution_amount),
      m.status.charAt(0).toUpperCase() + m.status.slice(1),
      m.joined_at ? fmt.date(m.joined_at) : "—",
    ])

    autoTable(doc, {
      startY: y,
      head: [["#", "Member Address", "Contribution", "Status", "Joined"]],
      body: memberRows,
      margin: { left: MARGIN, right: MARGIN },
      styles: {
        fontSize: 8,
        cellPadding: 3,
        textColor: C.dark,
        lineColor: C.border,
        lineWidth: 0.3,
      },
      headStyles: {
        fillColor: C.primary,
        textColor: C.white,
        fontStyle: "bold",
        fontSize: 8,
      },
      alternateRowStyles: { fillColor: C.light },
      columnStyles: {
        0: { cellWidth: 8 },
        1: { cellWidth: 68, font: "courier", fontSize: 7 },
        2: { cellWidth: 30, halign: "right" },
        3: { cellWidth: 22, halign: "center" },
        4: { cellWidth: 30 },
      },
    })

    y = (doc as any).lastAutoTable.finalY + 8
  }

  // ── 4. Fee Breakdown ───────────────────────────────────────────────────────

  sectionHeader("Fee Breakdown")

  const totalDeposits = pool.pool_activity
    .filter((a) => a.activity_type === "deposit")
    .reduce((s, a) => s + (a.amount ?? 0), 0)

  const totalPayouts = pool.pool_activity
    .filter((a) => a.activity_type === "payout")
    .reduce((s, a) => s + (a.amount ?? 0), 0)

  const totalWithdrawn = pool.pool_activity
    .filter((a) => ["withdraw", "refund"].includes(a.activity_type))
    .reduce((s, a) => s + (a.amount ?? 0), 0)

  const feeRows = [
    ["Total Deposits", fmt.xlm(totalDeposits)],
    ["Total Payouts", fmt.xlm(totalPayouts)],
    ["Total Withdrawals / Refunds", fmt.xlm(totalWithdrawn)],
    ["Net Pool Balance", fmt.xlm(totalDeposits - totalPayouts - totalWithdrawn)],
  ]

  autoTable(doc, {
    startY: y,
    body: feeRows,
    margin: { left: MARGIN, right: MARGIN },
    styles: {
      fontSize: 8.5,
      cellPadding: 3.5,
      textColor: C.dark,
      lineColor: C.border,
      lineWidth: 0.3,
    },
    alternateRowStyles: { fillColor: C.light },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 100 },
      1: { halign: "right", cellWidth: 78 },
    },
    didParseCell: (data) => {
      if (data.row.index === 3) {
        data.cell.styles.fontStyle = "bold"
        data.cell.styles.textColor = C.primary
      }
    },
  })

  y = (doc as any).lastAutoTable.finalY + 8

  // ── 5. Activity Log ────────────────────────────────────────────────────────

  const activities = [...pool.pool_activity].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  sectionHeader(`Activity Log (${activities.length} events)`)

  if (activities.length === 0) {
    doc.setFont("helvetica", "italic")
    doc.setFontSize(8.5)
    doc.setTextColor(...C.muted)
    doc.text("No activity recorded.", MARGIN, y)
    y += 8
  } else {
    const actRows = activities.map((a) => [
      fmt.datetime(a.created_at),
      fmt.actType(a.activity_type),
      fmt.addr(a.user_address),
      a.amount != null ? `${a.amount.toFixed(7)} XLM` : "—",
      a.tx_hash ? `${a.tx_hash.slice(0, 10)}…` : "—",
      a.source === "onchain" ? "On-chain" : "Off-chain",
    ])

    autoTable(doc, {
      startY: y,
      head: [["Date / Time", "Event", "Address", "Amount", "Tx Hash", "Source"]],
      body: actRows,
      margin: { left: MARGIN, right: MARGIN },
      styles: {
        fontSize: 7.5,
        cellPadding: 2.5,
        textColor: C.dark,
        lineColor: C.border,
        lineWidth: 0.3,
        overflow: "ellipsize",
      },
      headStyles: {
        fillColor: C.primary,
        textColor: C.white,
        fontStyle: "bold",
        fontSize: 7.5,
      },
      alternateRowStyles: { fillColor: C.light },
      columnStyles: {
        0: { cellWidth: 34 },
        1: { cellWidth: 24 },
        2: { cellWidth: 28, font: "courier", fontSize: 7 },
        3: { cellWidth: 28, halign: "right" },
        4: { cellWidth: 26, font: "courier", fontSize: 7 },
        5: { cellWidth: 22, halign: "center" },
      },
    })

    y = (doc as any).lastAutoTable.finalY + 8
  }

  // ── Footer on every page ───────────────────────────────────────────────────

  const totalPages = (doc as any).internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFontSize(7)
    doc.setTextColor(...C.muted)
    doc.setFont("helvetica", "normal")
    // Left: branding
    doc.text("JointSave • Pool Summary Report", MARGIN, 292)
    // Center: pool id
    doc.text(`Pool ID: ${pool.id}`, PAGE_W / 2, 292, { align: "center" })
    // Right: page count
    doc.text(`Page ${p} of ${totalPages}`, PAGE_W - MARGIN, 292, {
      align: "right",
    })
    // Top border line on non-first pages
    if (p > 1) {
      doc.setDrawColor(...C.border)
      doc.setLineWidth(0.3)
      doc.line(MARGIN, 12, PAGE_W - MARGIN, 12)
    }
    // Footer line
    doc.setDrawColor(...C.border)
    doc.line(MARGIN, 288, PAGE_W - MARGIN, 288)
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  const safeName = pool.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()
  doc.save(`jointsave_${safeName}_summary.pdf`)
}
