"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { GroupDetails } from "@/components/group/group-details";
import { GroupMembers } from "@/components/group/group-members";
import { GroupActivity } from "@/components/group/group-activity";
import { GroupDiscussion } from "@/components/group/group-discussion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GroupActions } from "@/components/group/group-actions";
import { YieldDashboard } from "@/components/group/yield-dashboard";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { fetchIsPaused, fetchPoolAdmin } from "@/hooks/useJointSaveContracts";
import { useStellar } from "@/components/web3-provider";
import { useRecentPools } from "@/hooks/useRecentPools";

interface Pool {
  id: string;
  name: string;
  type: "rotational" | "target" | "flexible";
  contract_address: string;
  token_address: string;
}

const isPendingAddress = (addr: string) =>
  !addr || addr === "pending_deployment";

export default function GroupPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { address } = useStellar();
  const { trackVisit } = useRecentPools(address);
  const [pool, setPool] = useState<Pool | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [poolAdmin, setPoolAdmin] = useState<string | null>(null);
  const trackedRef = useRef(false);

  useEffect(() => {
    fetch(`/api/pools?id=${id}`)
      .then((res) => res.json())
      .then((data) => {
        setPool(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  // Track visit when pool data loads
  useEffect(() => {
    if (pool && !loading && !trackedRef.current) {
      trackedRef.current = true;
      trackVisit({
        id: pool.id,
        name: pool.name,
        type: pool.type,
        contract_address: pool.contract_address,
      });
    }
    // Reset tracker when navigating to a different pool
    if (!pool || loading) {
      trackedRef.current = false;
    }
  }, [pool, loading, trackVisit]);

  const refreshPoolState = useCallback(async () => {
    if (!pool || isPendingAddress(pool.contract_address)) return;
    try {
      const [paused, admin] = await Promise.all([
        fetchIsPaused(pool.contract_address),
        fetchPoolAdmin(pool.contract_address),
      ]);
      setIsPaused(paused);
      setPoolAdmin(admin);
    } catch {}
  }, [pool]);

  useEffect(() => {
    refreshPoolState();
  }, [refreshPoolState]);

  if (loading) return <div>Loading...</div>;
  if (!pool) return <div>Pool not found</div>;

  const cacheKey =
    pool.contract_address && pool.contract_address !== "pending_deployment"
      ? pool.contract_address
      : pool.id;

  return (
    <div className="min-h-screen bg-background">
      <DashboardHeader />
      <main className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Button variant="ghost" className="mb-6" asChild>
          <Link href="/dashboard">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Link>
        </Button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <GroupDetails groupId={id} contractAddress={cacheKey} />
            <Tabs defaultValue="activity" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="activity">Activity Log</TabsTrigger>
                <TabsTrigger value="discussion">Discussion</TabsTrigger>
              </TabsList>
              <TabsContent value="activity" className="mt-4">
                <GroupActivity
                  groupId={id}
                  contractAddress={cacheKey}
                  startLedger={0}
                />
              </TabsContent>
              <TabsContent value="discussion" className="mt-4">
                <GroupDiscussion groupId={id} walletAddress={address} />
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-6">
            <GroupActions
              groupId={id}
              poolAddress={pool.contract_address}
              poolType={pool.type}
              tokenAddress={pool.token_address}
              isPaused={isPaused}
              poolAdmin={poolAdmin}
              onPauseChange={refreshPoolState}
            />
            {pool.type === "flexible" && (
              <YieldDashboard poolAddress={pool.contract_address} />
            )}
            <GroupMembers
              groupId={id}
              contractAddress={cacheKey}
              poolType={pool.type}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

