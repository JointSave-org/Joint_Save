import { NextResponse } from 'next/server';

const SUBGRAPH_URL = process.env.NEXT_PUBLIC_SUBGRAPH_URL || "https://api.thegraph.com/subgraphs/name/protocol/analytics";

const QUERY = `
  query GetProtocolSummary {
    protocols(first: 1) {
      totalValueLockedUSD
      totalVolumeUSD
      activePoolsCount
      totalMembers
    }
    protocolDayDatas(first: 30, orderBy: date, orderDirection: desc) {
      date
      tvlUSD
      dailyVolumeUSD
    }
    pools(first: 10, orderBy: totalValueLockedUSD, orderDirection: desc) {
      id
      totalValueLockedUSD
      volumeUSD
      isActive
    }
  }
`;

export async function GET() {
  try {
    const res = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY }),
      next: { revalidate: 60 } // Cache payload for 60 seconds
    });

    const { data, errors } = await res.json();
    if (errors) throw new Error(JSON.stringify(errors));

    return NextResponse.json({ success: true, data }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch protocol analytics" },
      { status: 500 }
    );
  }
}