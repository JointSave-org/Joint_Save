import { supabase } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { pool_id, requester_address } = body
    if (!pool_id || !requester_address) {
      return NextResponse.json({ error: 'pool_id and requester_address required' }, { status: 400 })
    }

    const { data, error } = await supabase.from('join_requests').insert([
      { pool_id, requester_address: requester_address.toLowerCase(), status: 'pending' }
    ])

    if (error) {
      console.error('Join request error:', error)
      return NextResponse.json({ error: error.message || 'Failed to create join request' }, { status: 500 })
    }

    return NextResponse.json({ success: true, request: data?.[0] }, { status: 201 })
  } catch (err) {
    console.error('Join request exception:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 })
  }
}
