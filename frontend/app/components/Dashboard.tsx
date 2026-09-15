'use client';

import React, { useEffect, useState } from 'react';
import { Activity, DollarSign, Layers, Users, ArrowUpRight, ShieldAlert } from 'lucide-react';

interface AnalyticsData {
  protocol: {
    totalValueLockedUSD: string;
    totalVolumeUSD: string;
    activePoolsCount: string;
    totalMembers: string;
  };
  pools: Array<{ id: string; totalValueLockedUSD: string; volumeUSD: string; isActive: boolean }>;
}

export default function AnalyticsDashboard() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/v1/protocol/summary');
        const json = await res.json();
        if (json.success && json.data.protocols[0]) {
          setData({
            protocol: json.data.protocols[0],
            pools: json.data.pools
          });
        } else {
          setError(true);
        }
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) return <div className="p-8 text-slate-400 font-mono animate-pulse">Loading protocol state...</div>;
  if (error || !data) return (
    <div className="p-4 border border-red-500/20 bg-red-500/10 rounded-lg text-red-400 flex items-center gap-2">
      <ShieldAlert className="w-5 h-5" />
      <span>Failed to fetch real-time analytics from Subgraph node.</span>
    </div>
  );

  const { protocol, pools } = data;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-8 space-y-8 font-sans">
      <header className="flex justify-between items-center border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Protocol Analytics</h1>
          <p className="text-sm text-slate-400">Real-time metrics & liquidity overview</p>
        </div>
        <span className="px-3 py-1 text-xs rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" /> Live Indexer
        </span>
      </header>

      {/* Primary KPI Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Total Value Locked" value={`$${Number(protocol.totalValueLockedUSD).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} icon={<DollarSign className="text-emerald-400" />} />
        <KpiCard title="Cumulative Volume" value={`$${Number(protocol.totalVolumeUSD).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} icon={<Activity className="text-blue-400" />} />
        <KpiCard title="Active Pools" value={protocol.activePoolsCount} icon={<Layers className="text-purple-400" />} />
        <KpiCard title="Total Members" value={protocol.totalMembers} icon={<Users className="text-amber-400" />} />
      </div>

      {/* Pool Breakdown Table */}
      <div className="border border-slate-800 rounded-xl bg-slate-900/50 overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center">
          <h2 className="font-semibold text-lg">Top Active Pools</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-400">
            <thead className="bg-slate-800/50 text-slate-200 text-xs uppercase tracking-wider">
              <tr>
                <th className="p-4">Pool Address</th>
                <th className="p-4">TVL (USD)</th>
                <th className="p-4">Total Volume</th>
                <th className="p-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {pools.map((pool) => (
                <tr key={pool.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="p-4 font-mono text-slate-300 flex items-center gap-1">
                    {pool.id.slice(0, 6)}...{pool.id.slice(-4)}
                    <ArrowUpRight className="w-3.5 h-3.5 text-slate-500" />
                  </td>
                  <td className="p-4 text-slate-200 font-medium">${Number(pool.totalValueLockedUSD).toLocaleString()}</td>
                  <td className="p-4">${Number(pool.volumeUSD).toLocaleString()}</td>
                  <td className="p-4">
                    <span className={`px-2 py-0.5 text-xs rounded ${pool.isActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
                      {pool.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="p-5 border border-slate-800 rounded-xl bg-slate-900/40 space-y-3">
      <div className="flex justify-between items-center text-slate-400">
        <span className="text-xs uppercase font-medium">{title}</span>
        {icon}
      </div>
      <div className="text-2xl font-bold tracking-tight text-slate-100">{value}</div>
    </div>
  );
}