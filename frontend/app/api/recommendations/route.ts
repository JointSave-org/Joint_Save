import { supabase } from "@/lib/supabase"
import { NextRequest, NextResponse } from "next/server"
import { readLimiter } from "@/lib/rate-limit"

interface RecommendationResponse {
  pools: {
    pool_id: string
    score: number
    reasons: string[]
    pool?: { health_score: number }
  }[]
}

interface CacheEntry {
  data: RecommendationResponse
  timestamp: number
}
const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export async function GET(req: NextRequest) {
  try {
    const limited = readLimiter(req)
    if (limited) return limited

    const wallet = req.nextUrl.searchParams.get("wallet")?.toLowerCase()
    if (!wallet) {
      return NextResponse.json({ error: "wallet is required" }, { status: 400 })
    }

    // Check cache
    const cached = cache.get(wallet)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return NextResponse.json(cached.data)
    }

    // Fetch user's past pool memberships
    const { data: pastMemberships, error: memErr } = await supabase
      .from("pool_members")
      .select('pool_id, contribution_amount, pools!inner(type, status)')
      .eq("member_address", wallet)

    if (memErr) throw memErr

    // Determine type affinities & avg deposit & past pools & past co-members
    const pastPoolIds = new Set<string>()
    const completedTypes = new Set<string>()
    let totalDeposit = 0
    let depositCount = 0

    if (pastMemberships) {
      for (const m of pastMemberships) {
        pastPoolIds.add(m.pool_id)
        if (m.pools && !Array.isArray(m.pools) && m.pools.status === "completed") {
          completedTypes.add(m.pools.type)
        }
        if (m.contribution_amount > 0) {
          totalDeposit += m.contribution_amount
          depositCount++
        }
      }
    }

    const avgDeposit = depositCount > 0 ? totalDeposit / depositCount : 0

    // Fetch past co-members
    const pastCoMembers = new Set<string>()
    if (pastPoolIds.size > 0) {
       const { data: coMembers } = await supabase
        .from("pool_members")
        .select("member_address")
        .in("pool_id", Array.from(pastPoolIds))
        .neq("member_address", wallet)

       if (coMembers) {
         coMembers.forEach(m => pastCoMembers.add(m.member_address.toLowerCase()))
       }
    }

    // Fetch all active pools we can recommend
    const { data: pools, error: poolsErr } = await supabase
      .from("pools")
      .select("id, type, contribution_amount, created_at, pool_members(member_address)")
      .eq("status", "active")
      
    if (poolsErr) throw poolsErr
    
    // Fetch pool health scores for active pools
    const activePoolIds = pools?.map(p => p.id) || []
    const healthMap = new Map<string, number>()
    
    if (activePoolIds.length > 0) {
      const { data: healthData } = await supabase
        .from("pool_health_scores")
        .select("pool_id, health_score")
        .in("pool_id", activePoolIds)
        
      if (healthData) {
        healthData.forEach(h => healthMap.set(h.pool_id, h.health_score))
      }
    }

    // Score pools
    const scoredPools = []
    const now = new Date().getTime()
    
    for (const pool of (pools || [])) {
       if (pastPoolIds.has(pool.id)) continue // Skip pools user is already in

       let score = 0
       const reasons = []

       // Type affinity
       if (completedTypes.has(pool.type)) {
         score += 20
         reasons.push("Matches types of pools you've completed")
       }

       // Health score match
       const healthScore = healthMap.get(pool.id) || 0
       if (healthScore > 70) {
         score += 15
         reasons.push("High pool health score")
       }

       // Deposit compatibility
       if (pool.contribution_amount !== null && avgDeposit > 0) {
          if (pool.contribution_amount >= avgDeposit * 0.5 && pool.contribution_amount <= avgDeposit * 2.0) {
            score += 10
            reasons.push("Matches your usual contribution amounts")
          }
       }

       // Member overlap
       let overlapFound = false
       if (pool.pool_members) {
         for (const pm of pool.pool_members) {
            if (pastCoMembers.has(pm.member_address.toLowerCase())) {
              overlapFound = true
              break
            }
         }
       }
       if (overlapFound) {
         score += 5
         reasons.push("Has members you've pooled with before")
       }

       // Recency
       const createdAt = new Date(pool.created_at).getTime()
       const ageDays = (now - createdAt) / (1000 * 60 * 60 * 24)
       if (ageDays <= 7) {
         score += 5
         reasons.push("Recently created")
       }

       if (score > 0) {
         scoredPools.push({
           pool_id: pool.id,
           score,
           reasons,
           pool: {
             ...pool,
             health_score: healthScore
           }
         })
       }
    }

    scoredPools.sort((a, b) => b.score - a.score)
    const top5 = scoredPools.slice(0, 5)

    const responseData = { pools: top5 }
    
    // Set cache
    cache.set(wallet, { data: responseData, timestamp: Date.now() })

    return NextResponse.json(responseData)
  } catch (_error) {
    // Return standard error payload
    return NextResponse.json({ error: "Failed to generate recommendations" }, { status: 500 })
  }
}
