"use client"

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useStellar } from '@/components/web3-provider'
import { useToast } from '@/hooks/use-toast'
import { fetchRotationalState, fetchTargetState, fetchFlexibleState, stroopsToXlm } from '@/hooks/useJointSaveContracts'

export default function JoinActions({ poolId, contractId, poolType, contributionAmount, minimumDeposit }: {
  poolId: string
  contractId: string
  poolType: string
  contributionAmount?: number | null
  minimumDeposit?: number | null
}) {
  const { address, connect } = useStellar()
  const { toast } = useToast()
  const [onchainInfo, setOnchainInfo] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        if (!contractId) return
        if (poolType === 'rotational') {
          const s = await fetchRotationalState(contractId)
          if (mounted) setOnchainInfo(s)
        } else if (poolType === 'target') {
          const s = await fetchTargetState(contractId)
          if (mounted) setOnchainInfo(s)
        } else {
          const s = await fetchFlexibleState(contractId)
          if (mounted) setOnchainInfo(s)
        }
      } catch (e) {}
    })()
    return () => { mounted = false }
  }, [contractId, poolType])

  const handleRequestJoin = async () => {
    if (!address) return connect()
    setLoading(true)
    try {
      const res = await fetch('/api/join-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pool_id: poolId, requester_address: address })
      })
      if (!res.ok) throw new Error('Failed to send request')
      toast({ title: 'Request submitted', description: 'The creator will review your request.' })
    } catch (e) {
      toast({ title: 'Request failed' })
    } finally {
      setLoading(false)
    }
  }

  const depositReq = () => {
    if (poolType === 'rotational') return contributionAmount ? `${contributionAmount} XLM` : 'N/A'
    if (poolType === 'target') return onchainInfo ? `${stroopsToXlm(onchainInfo.totalDeposited).toFixed(2)} / ${stroopsToXlm(onchainInfo.targetAmount).toFixed(2)} XLM` : 'N/A'
    return minimumDeposit ? `${minimumDeposit} XLM` : 'N/A'
  }

  return (
    <Card className="p-6">
      <h2 className="text-xl font-semibold mb-2">Join Pool</h2>
      <p className="text-sm text-muted-foreground mb-4">Deposit requirement: {depositReq()}</p>
      <div className="space-x-2">
        {!address ? (
          <Button onClick={() => connect()}>Connect Wallet to Request Join</Button>
        ) : (
          <Button onClick={handleRequestJoin} disabled={loading}>{loading ? 'Requesting...' : 'Request to Join'}</Button>
        )}
      </div>
    </Card>
  )
}
