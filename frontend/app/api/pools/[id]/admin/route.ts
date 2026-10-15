import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { checkWalletProof } from '@/lib/server/wallet-proof'

// Rate limiting: track admin actions per pool
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute
const MAX_ACTIONS_PER_WINDOW = 5

function checkRateLimit(poolId: string, adminAddress: string): boolean {
  const key = `${poolId}:${adminAddress}`
  const now = Date.now()
  const record = rateLimitMap.get(key)

  if (!record || now > record.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW })
    return true
  }

  if (record.count >= MAX_ACTIONS_PER_WINDOW) {
    return false
  }

  record.count++
  return true
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: poolId } = await params
    const body = await req.json()
    const { action, proof, reason, recipient } = body

    // Validate action
    if (!['pause', 'unpause', 'emergency_withdraw'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action' },
        { status: 400 }
      )
    }

    // Validate proof structure
    if (!proof || !proof.message || !proof.signature || !proof.publicKey) {
      return NextResponse.json(
        { error: 'Missing wallet proof' },
        { status: 400 }
      )
    }

    // Fetch pool from database
    const { data: pool, error: poolError } = await supabase
      .from('pools')
      .select('*')
      .eq('id', poolId)
      .single()

    if (poolError || !pool) {
      return NextResponse.json(
        { error: 'Pool not found' },
        { status: 404 }
      )
    }

    // Verify wallet proof against pool creator
    const verificationResult = await checkWalletProof(proof, pool.creator_address)

    if (!verificationResult.valid) {
      return NextResponse.json(
        { error: verificationResult.error || 'Invalid wallet proof' },
        { status: 403 }
      )
    }

    // Check rate limiting
    if (!checkRateLimit(poolId, proof.publicKey)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        { status: 429 }
      )
    }

    // Validate pool is eligible for the action
    if (action === 'pause' && pool.status === 'paused') {
      return NextResponse.json(
        { error: 'Pool is already paused' },
        { status: 400 }
      )
    }

    if (action === 'unpause' && pool.status !== 'paused') {
      return NextResponse.json(
        { error: 'Pool is not paused' },
        { status: 400 }
      )
    }

    if (action === 'emergency_withdraw' && !['active', 'paused'].includes(pool.status)) {
      return NextResponse.json(
        { error: 'Pool is not eligible for emergency withdrawal' },
        { status: 400 }
      )
    }

    // Handle each action
    let txHash: string | null = null
    let updateData: Record<string, string | null> = {}
    let activityDescription = ''

    switch (action) {
      case 'pause':
        updateData = {
          status: 'paused',
          pause_reason: reason || 'Manual pause by admin',
          paused_at: new Date().toISOString(),
        }
        activityDescription = `Pool paused: ${reason || 'Manual pause by admin'}`
        // TODO: Call on-chain pause when contract is updated
        txHash = 'pending' // Placeholder for on-chain tx
        break

      case 'unpause':
        updateData = {
          status: 'active',
          pause_reason: null,
          paused_at: null,
        }
        activityDescription = 'Pool resumed by admin'
        // TODO: Call on-chain unpause when contract is updated
        txHash = 'pending' // Placeholder for on-chain tx
        break

      case 'emergency_withdraw':
        if (!recipient) {
          return NextResponse.json(
            { error: 'Recipient address required for emergency withdrawal' },
            { status: 400 }
          )
        }
        updateData = {
          status: 'completed',
        }
        activityDescription = `Emergency withdrawal to ${recipient}`
        // TODO: Call on-chain emergency_withdraw when contract is updated
        txHash = 'pending' // Placeholder for on-chain tx
        break
    }

    // Update pool status
    const { error: updateError } = await supabase
      .from('pools')
      .update(updateData)
      .eq('id', poolId)

    if (updateError) {
      console.error('Pool update error:', updateError)
      return NextResponse.json(
        { error: 'Failed to update pool status' },
        { status: 500 }
      )
    }

    // Log activity
    const { error: activityError } = await supabase
      .from('pool_activity')
      .insert([
        {
          pool_id: poolId,
          activity_type: `admin_${action}`,
          user_address: proof.publicKey.toLowerCase(),
          description: activityDescription,
          tx_hash: txHash,
        },
      ])

    if (activityError) {
      console.error('Activity log error:', activityError)
    }

    return NextResponse.json({
      success: true,
      action,
      txHash,
      timestamp: verificationResult.timestamp,
    })
  } catch (error) {
    console.error('Admin action error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
