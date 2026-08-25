import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { readLimiter, writeLimiter } from "@/lib/rate-limit"
import { jsonPrivate } from "@/lib/cache-headers"
import {
  validateTemplateName,
  validateTemplateDescription,
  isTemplatePoolType,
  isTemplateConfig,
} from "@/lib/templates"

/**
 * POST /api/templates — save a new pool configuration as a reusable template.
 * Body: { creator_address, name, description?, pool_type, config, is_public? }
 */
export async function POST(req: NextRequest) {
  const limited = writeLimiter(req)
  if (limited) return limited

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const creatorAddress = typeof body.creator_address === "string" ? body.creator_address.trim() : ""
  const name = body.name
  const description = body.description == null ? null : body.description
  const poolType = body.pool_type
  const config = body.config
  const isPublic = body.is_public === true

  if (!creatorAddress) {
    return NextResponse.json({ error: "creator_address required" }, { status: 400 })
  }
  const nameResult = validateTemplateName(name)
  if (!nameResult.valid) {
    return NextResponse.json({ error: nameResult.message }, { status: 400 })
  }
  const descriptionResult = validateTemplateDescription(description)
  if (!descriptionResult.valid) {
    return NextResponse.json({ error: descriptionResult.message }, { status: 400 })
  }
  if (!isTemplatePoolType(poolType)) {
    return NextResponse.json(
      { error: "pool_type must be rotational, target, or flexible" },
      { status: 400 }
    )
  }
  if (!isTemplateConfig(config)) {
    return NextResponse.json(
      { error: "config must be a JSON object of pool creation parameters" },
      { status: 400 }
    )
  }

  try {
    const admin = getAdminClient()
    const { data, error } = await admin
      .from("pool_templates")
      .insert({
        creator_address: creatorAddress.toLowerCase(),
        name: (name as string).trim(),
        description: description === "" ? null : (description as string),
        pool_type: poolType as "rotational" | "target" | "flexible",
        config,
        is_public: isPublic,
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    console.error("Template create error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create template" },
      { status: 500 }
    )
  }
}

/**
 * GET /api/templates
 *   ?id=X      — fetch a single template (own or public)
 *   ?wallet=X  — fetch the caller's templates
 */
export async function GET(req: NextRequest) {
  const limited = readLimiter(req)
  if (limited) return limited

  const id = req.nextUrl.searchParams.get("id")
  const wallet = req.nextUrl.searchParams.get("wallet")

  try {
    const admin = getAdminClient()

    if (id) {
      const { data, error } = await admin
        .from("pool_templates")
        .select("*")
        .eq("id", id)
        .maybeSingle()
      if (error) throw error
      if (!data) {
        return NextResponse.json({ error: "Template not found" }, { status: 404 })
      }
      return jsonPrivate(data)
    }

    if (wallet) {
      const { data, error } = await admin
        .from("pool_templates")
        .select("*")
        .eq("creator_address", wallet.toLowerCase())
        .order("created_at", { ascending: false })
      if (error) throw error
      return jsonPrivate({ data: data || [], total: data?.length ?? 0 })
    }

    return NextResponse.json({ error: "Specify id or wallet" }, { status: 400 })
  } catch (error) {
    console.error("Template fetch error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch templates" },
      { status: 500 }
    )
  }
}
