import { supabase, savePoolToDatabase } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    const {
      name,
      description,
      poolType,
      creatorAddress,
      poolAddress,
      tokenAddress,
      members,
      contributionAmount,
      roundDuration,
      frequency,
      targetAmount,
      deadline,
      minimumDeposit,
      withdrawalFee,
      yieldEnabled,
      txHash,
    } = body

    // Validate required fields
    if (!name || !poolType || !creatorAddress || !poolAddress || !tokenAddress || !members?.length) {
      return NextResponse.json(
        { error: 'Missing required fields. Need: name, poolType, creatorAddress, poolAddress, tokenAddress, members' },
        { status: 400 }
      )
    }

    // Use the helper function from supabase.ts
    const result = await savePoolToDatabase({
      name,
      description,
      poolType,
      creatorAddress,
      contractAddress: poolAddress,
      tokenAddress,
      members,
      contributionAmount,
      roundDuration,
      frequency,
      targetAmount,
      deadline,
      minimumDeposit,
      withdrawalFee,
      yieldEnabled,
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to save pool' },
        { status: 500 }
      )
    }

    // Log the pool creation activity with tx hash
    if (txHash && result.poolId) {
      await supabase.from('pool_activity').insert([
        {
          pool_id: result.poolId,
          activity_type: 'pool_created',
          user_address: creatorAddress.toLowerCase(),
          description: `${poolType} pool created`,
          tx_hash: txHash,
        },
      ])
    }

    return NextResponse.json(result.pool, { status: 201 })
  } catch (error) {
    console.error('Pool creation error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  try {
    const poolId = req.nextUrl.searchParams.get('id')
    const creatorAddress = req.nextUrl.searchParams.get('creator')
    const contractAddress = req.nextUrl.searchParams.get('contract')

    if (poolId) {
      // Fetch single pool by ID
      const { data, error } = await supabase
        .from('pools')
        .select(`
          *,
          pool_members (
            id,
            member_address,
            contribution_amount,
            status
          ),
          pool_activity (
            id,
            activity_type,
            user_address,
            amount,
            description,
            created_at,
            tx_hash
          )
        `)
        .eq('id', poolId)
        .single()

      if (error) {
        return NextResponse.json(
          { error: 'Pool not found' },
          { status: 404 }
        )
      }

      return NextResponse.json(data)
    } else if (contractAddress) {
      // Fetch single pool by contract address
      const { data, error } = await supabase
        .from('pools')
        .select(`
          *,
          pool_members (
            id,
            member_address,
            contribution_amount,
            status
          ),
          pool_activity (
            id,
            activity_type,
            user_address,
            amount,
            description,
            created_at,
            tx_hash
          )
        `)
        .eq('contract_address', contractAddress)
        .single()

      if (error) {
        return NextResponse.json(
          { error: 'Pool not found' },
          { status: 404 }
        )
      }

      return NextResponse.json(data)
    } else if (creatorAddress) {
      const PAGE_SIZE = 6
      const page = Math.max(0, parseInt(req.nextUrl.searchParams.get('page') || '0', 10))
      const from = page * PAGE_SIZE
      const to = from + PAGE_SIZE - 1

      const { data, error, count } = await supabase
        .from('pools')
        .select('*', { count: 'exact' })
        .eq('creator_address', creatorAddress.toLowerCase())
        .order('created_at', { ascending: false })
        .range(from, to)

      if (error) {
        throw error
      }

      return NextResponse.json({ data: data || [], total: count ?? 0, page, pageSize: PAGE_SIZE })
    } else {
      // Fetch all pools
      const { data, error } = await supabase
        .from('pools')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) {
        throw error
      }

      return NextResponse.json(data || [])
    }
  } catch (error) {
    console.error('Pool fetch error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const poolId = req.nextUrl.searchParams.get('id') || body.id

    if (!poolId) {
      return NextResponse.json({ error: 'Pool ID required' }, { status: 400 })
    }

    // If body contains an `activity` object, log it to pool_activity
    if (body.activity) {
      const { activity_type, user_address, amount, tx_hash } = body.activity
      const { error: actErr } = await supabase.from('pool_activity').insert([{
        pool_id: poolId,
        activity_type,
        user_address: user_address?.toLowerCase() || null,
        amount: amount || null,
        tx_hash: tx_hash || null,
        description: `${activity_type} transaction`,
      }])
      if (actErr) console.error('Activity log error:', actErr)
      return NextResponse.json({ success: true })
    }

    // Otherwise update pool fields
    const { id: _id, activity: _activity, ...updateFields } = body
    const { data, error } = await supabase
      .from('pools')
      .update(updateFields)
      .eq('id', poolId)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: 'Failed to update pool' }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Pool update error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}