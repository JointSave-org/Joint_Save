// src/components/create-group/BulkImport.tsx
import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertCircle, X } from "lucide-react"
import Papa from "papaparse"
import { isValidStellarAddress } from "@/utils/stellarAddress"
import { MAX_POOL_MEMBERS } from "@/lib/constants"

type Member = {
  address: string
  name?: string
  line: number
}

type BulkImportProps = {
  /**
   * Callback with an array of valid Stellar addresses (strings) extracted from the CSV.
   * The parent component can use this to set its members state.
   */
  onMembersChange: (addresses: string[]) => void
}

export default function BulkImport({ onMembersChange }: BulkImportProps) {
  const t = useTranslations("pool.create.bulkImport")
  const [members, setMembers] = useState<Member[]>([])
  const [errors, setErrors] = useState<string[]>([])

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    Papa.parse<string[]>(file, {
      skipEmptyLines: true,
      complete: (results) => {
        const parsed: Member[] = []
        const errorLines: string[] = []
        const firstLineForAddress = new Map<string, number>()
        results.data.forEach((row, idx) => {
          const lineNum = idx + 1
          const address = row[0]?.trim() ?? ""
          const name = row[1]?.trim()
          if (!address) {
            errorLines.push(t("emptyAddress", { line: lineNum }))
            return
          }
          if (!isValidStellarAddress(address)) {
            errorLines.push(t("invalidAddress", { line: lineNum }))
            return
          }
          const firstLine = firstLineForAddress.get(address)
          if (firstLine !== undefined) {
            errorLines.push(t("duplicateAddress", { line: lineNum, firstLine }))
            return
          }
          firstLineForAddress.set(address, lineNum)
          parsed.push({ address, name, line: lineNum })
        })
        if (parsed.length > MAX_POOL_MEMBERS) {
          errorLines.push(t("tooManyMembers", { count: parsed.length, max: MAX_POOL_MEMBERS }))
        }
        const acceptedMembers = parsed.slice(0, MAX_POOL_MEMBERS)
        setMembers(acceptedMembers)
        setErrors(errorLines)
        onMembersChange(acceptedMembers.map((m) => m.address))
      },
      error: (err) => {
        setErrors([t("parsingError", { message: err.message })])
        setMembers([])
        onMembersChange([])
      },
    })
  }

  const removeMember = (line: number) => {
    const newMembers = members.filter((m) => m.line !== line)
    setMembers(newMembers)
    onMembersChange(newMembers.map((m) => m.address))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input type="file" accept=".csv" onChange={handleFile} />
        <span className="text-sm text-muted-foreground">
          {t.rich("csvFormat", { code: (chunks) => <code>{chunks}</code> })}
        </span>
      </div>

      {errors.length > 0 && (
        <div className="flex items-start gap-2 p-3 bg-destructive/10 text-destructive rounded-lg">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <ul className="list-disc list-inside text-sm">
            {errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {members.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="p-2 text-left">{t("lineHeader")}</th>
                <th className="p-2 text-left">{t("addressHeader")}</th>
                <th className="p-2 text-left">{t("nameHeader")}</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.line} className="border-b border-muted/20">
                  <td className="p-2">{m.line}</td>
                  <td className="p-2 font-mono text-xs">{m.address}</td>
                  <td className="p-2">{m.name ?? "-"}</td>
                  <td className="p-2 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeMember(m.line)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
