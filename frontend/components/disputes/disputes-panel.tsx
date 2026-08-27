"use client"

/**
 * DisputesPanel — pool disputes feed (issue #208).
 * Composition root: loads disputes via useDisputes, renders the file-dispute
 * dialog (members only) and the dispute cards. Admin actions appear for the
 * pool creator. Rendered full-width below the group grid in GroupClient.
 */

import { useMemo } from "react"
import { useTranslations } from "next-intl"
import { Gavel } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useDisputes } from "@/hooks/useDisputes"
import { useStellar } from "@/components/web3-provider"
import { DisputeCard } from "./dispute-card"
import { FileDisputeDialog } from "./file-dispute-dialog"

interface DisputesPanelProps {
  poolId: string
  memberAddresses: string[]
  /** Pool creator address — gets the admin resolve buttons. */
  poolAdmin: string | null
}

export function DisputesPanel({ poolId, memberAddresses, poolAdmin }: DisputesPanelProps) {
  const t = useTranslations("group.disputes")
  const { address } = useStellar()

  const { disputes, loading, error, refresh, fileDispute, voteOnDispute, resolveDispute } =
    useDisputes(poolId)

  const isAdmin = useMemo(
    () => !!address && !!poolAdmin && address.toLowerCase() === poolAdmin.toLowerCase(),
    [address, poolAdmin]
  )
  const isMember = useMemo(
    () => !!address && memberAddresses.some((m) => m.toLowerCase() === address.toLowerCase()),
    [address, memberAddresses]
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Gavel className="h-4 w-4" />
          {t("title")}
        </CardTitle>
        <FileDisputeDialog
          disabled={!isMember}
          memberAddresses={memberAddresses.filter(
            (m) => !address || m.toLowerCase() !== address.toLowerCase()
          )}
          submitting={loading}
          onSubmit={async ({ disputeType, description, targetAddress, evidenceUrls }) =>
            !!address &&
            (await fileDispute({
              filerAddress: address,
              disputeType,
              description,
              targetAddress,
              evidenceUrls,
            }))
          }
        />
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="flex items-center justify-between gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <span>{error}</span>
            <button className="underline" onClick={() => void refresh()}>
              {t("retry")}
            </button>
          </div>
        )}

        {loading && disputes.length === 0 ? (
          <>
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </>
        ) : disputes.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          disputes.map((dispute) => (
            <DisputeCard
              key={dispute.id}
              dispute={dispute}
              viewerAddress={address ?? null}
              isAdmin={isAdmin}
              totalMembers={memberAddresses.length}
              onVote={(id, inFavor) => {
                if (address) void voteOnDispute(id, address, inFavor)
              }}
              onResolve={(id, outcome, resolution) => {
                if (address) void resolveDispute(id, address, outcome, resolution)
              }}
            />
          ))
        )}
      </CardContent>
    </Card>
  )
}
