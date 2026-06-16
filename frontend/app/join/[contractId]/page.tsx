import { supabase } from '@/lib/supabase'
import { notFound } from 'next/navigation'
import JoinActions from '@/components/join/join-actions'
import { Card } from '@/components/ui/card'

export default async function Page({ params }: { params: { contractId: string } }) {
  const contractId = params.contractId

  // Fetch pool by contract_address
  const { data: pool, error } = await supabase
    .from('pools')
    .select('*')
    .eq('contract_address', contractId)
    .limit(1)
    .single()

  if (error || !pool) {
    return (
      <Card className="p-8">
        <h2 className="text-2xl font-bold mb-2">Pool not found</h2>
        <p className="text-muted-foreground">The invite link appears invalid or the pool no longer exists.</p>
      </Card>
    )
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      <Card className="p-6 mb-4">
        <h1 className="text-3xl font-bold mb-2">{pool.name}</h1>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm text-muted-foreground">Type: {pool.type}</span>
          <span className="text-sm text-muted-foreground">Members: {pool.members_count}</span>
        </div>
        <p className="text-sm text-muted-foreground mb-2">Creator: {pool.creator_address}</p>
        <p className="text-sm text-muted-foreground mb-4">Contract: <span className="font-mono break-all">{pool.contract_address}</span></p>
      </Card>

      <JoinActions poolId={pool.id} contractId={pool.contract_address} poolType={pool.type} contributionAmount={pool.contribution_amount} minimumDeposit={pool.minimum_deposit} />
    </div>
  )
}
