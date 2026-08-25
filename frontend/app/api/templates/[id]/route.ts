import { NextRequest, NextResponse } from "next/server"
import { getAdminClient } from "@/lib/supabase-admin"
import { writeLimiter } from "@/lib/rate-limit"
import {
  validateTemplateName,
  validateTemplateDescription,
  isTemplatePoolType,
  isTemplateConfig,
} from "@/lib/templates"

async function getTemplate(admin: ReturnType<typeof getAdminClient>, id: string) {
  const { data, error } = await admin.from("pool_templates").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return data
}

/**
 * PUT /api/templates/[id]
 * Body (owner update): { wallet, name?, description?, pool_type?, config?, is_public? }
 * Body (usage):        { incrementUse: true } — bumps use_count (anyone)
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = writeLimiter(req)
  if (limited) return limited

  const { id } = await ctx.params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  try {
    const admin = getAdminClient()
    const template = await getTemplate(admin, id)
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 })
    }

    // Usage increment — no ownership requirement; a used template counts
    // regardless of whether the caller is the creator or browsing community.
    if (body.incrementUse === true) {
      const { data, error } = await admin
        .from("pool_templates")
        .update({ use_count: template.use_count + 1 })
        .eq("id", id)
        .select()
        .single()
      if (error) throw error
      return NextResponse.json(data)
    }

    const wallet = typeof body.wallet === "string" ? body.wallet.trim() : ""
    if (!wallet) {
      return NextResponse.json({ error: "wallet required" }, { status: 400 })
    }
    if (template.creator_address !== wallet.toLowerCase()) {
      return NextResponse.json({ error: "Only the template owner can update it" }, { status: 403 })
    }

    const update: {
      name?: string
      description?: string | null
      pool_type?: "rotational" | "target" | "flexible"
      config?: Record<string, unknown>
      is_public?: boolean
    } = {}
    if (body.name !== undefined) {
      const nameResult = validateTemplateName(body.name)
      if (!nameResult.valid)
        return NextResponse.json({ error: nameResult.message }, { status: 400 })
      update.name = (body.name as string).trim()
    }
    if (body.description !== undefined) {
      const description = body.description as string | null
      const descriptionResult = validateTemplateDescription(description)
      if (!descriptionResult.valid) {
        return NextResponse.json({ error: descriptionResult.message }, { status: 400 })
      }
      update.description = description === "" ? null : description
    }
    if (body.pool_type !== undefined) {
      if (!isTemplatePoolType(body.pool_type)) {
        return NextResponse.json(
          { error: "pool_type must be rotational, target, or flexible" },
          { status: 400 }
        )
      }
      update.pool_type = body.pool_type
    }
    if (body.config !== undefined) {
      if (!isTemplateConfig(body.config)) {
        return NextResponse.json(
          { error: "config must be a JSON object of pool creation parameters" },
          { status: 400 }
        )
      }
      update.config = body.config
    }
    if (body.is_public !== undefined) {
      update.is_public = body.is_public === true
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
    }

    const { data, error } = await admin
      .from("pool_templates")
      .update(update)
      .eq("id", id)
      .select()
      .single()
    if (error) throw error

    return NextResponse.json(data)
  } catch (error) {
    console.error("Template update error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update template" },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/templates/[id]
 * Body: { wallet } — owner only.
 */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = writeLimiter(req)
  if (limited) return limited

  const { id } = await ctx.params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const wallet = typeof body.wallet === "string" ? body.wallet.trim() : ""
  if (!wallet) {
    return NextResponse.json({ error: "wallet required" }, { status: 400 })
  }

  try {
    const admin = getAdminClient()
    const template = await getTemplate(admin, id)
    if (!template) {
      return NextResponse.json({ error: "Template not found" }, { status: 404 })
    }
    if (template.creator_address !== wallet.toLowerCase()) {
      return NextResponse.json({ error: "Only the template owner can delete it" }, { status: 403 })
    }

    const { error } = await admin.from("pool_templates").delete().eq("id", id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Template delete error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete template" },
      { status: 500 }
    )
  }
}
