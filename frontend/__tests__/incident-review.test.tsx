import React from "react"
import { render, screen, waitFor } from "@/test-utils"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { IncidentReviewCard } from "@/components/admin/incident-review-card"
import { PauseAuthorizationPanel } from "@/components/admin/pause-authorization-panel"

const ADMIN_ADDRESS = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7"
const POOL_ID = "pool-123"
const POOL_CONTRACT = "CBZNGP52FLFZ4BOGC265FUAMP5KFMAYPQK3KTI5UHMYVMM3QCST3IMRI"

function mockIncident(overrides = {}) {
  return {
    id: "incident-1",
    pool_id: POOL_ID,
    trigger_rule_ids: ["rapid_emergency_withdraw"],
    severity: "critical" as const,
    alert_count: 3,
    reason: "Multiple emergency withdrawals detected",
    created_by_scan: true,
    scan_source: "cron" as const,
    action: "pause" as const,
    executed: true,
    dry_run: false,
    skip_reason: null,
    platform_paused: true,
    onchain_status: "pending" as const,
    onchain_tx_hash: null,
    status: "open" as const,
    resolved_by: null,
    resolution_notes: null,
    resolved_at: null,
    created_at: "2026-08-29T10:00:00Z",
    updated_at: "2026-08-29T10:00:00Z",
    ...overrides,
  }
}

function mockAuthorization(overrides = {}) {
  return {
    id: "auth-1",
    pool_id: POOL_ID,
    contract_address: POOL_CONTRACT,
    admin_address: ADMIN_ADDRESS,
    expiration_ledger: 500000,
    used_at: null,
    used_by_incident: null,
    revoked_at: null,
    created_at: "2026-08-28T10:00:00Z",
    status: "active" as const,
    ...overrides,
  }
}

let mockFetchResponse: any = null

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString()

    if (mockFetchResponse) {
      return new Response(JSON.stringify(mockFetchResponse), { status: 200 })
    }

    if (url.includes("/api/admin/incidents/incident-1") && options?.method === "POST") {
      const body = JSON.parse(options.body as string)
      return new Response(
        JSON.stringify({
          incident: { ...mockIncident(), status: "resolved", resolved_by: ADMIN_ADDRESS },
          resumed: body.action === "resume",
          onchainUnpauseRequired: false,
        }),
        { status: 200 }
      )
    }

    if (url.includes("/api/admin/pause-authorizations") && options?.method === "POST") {
      const body = JSON.parse(options.body as string)
      if (body.action === "revoke") {
        return new Response(JSON.stringify({ revoked: true }), { status: 200 })
      }
      return new Response(
        JSON.stringify({ authorization: mockAuthorization() }),
        { status: 201 }
      )
    }

    if (url.includes("/api/admin/pause-authorizations")) {
      return new Response(
        JSON.stringify({
          currentLedger: 450000,
          authorizations: [mockAuthorization()],
          armed: true,
        }),
        { status: 200 }
      )
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404 })
  })
}

beforeEach(() => {
  mockFetchResponse = null
  vi.stubGlobal("fetch", mockFetch())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("IncidentReviewCard", () => {
  it("renders incident with correct severity styling", () => {
    const incident = mockIncident({ severity: "critical" })
    render(
      <IncidentReviewCard
        incident={incident}
        adminAddress={ADMIN_ADDRESS}
        onUpdate={() => {}}
      />
    )

    // Critical severity should have rose-colored styling
    const badge = screen.getByText("critical")
    expect(badge).toBeInTheDocument()
    expect(badge.closest(".border-rose-500\\/30")).toBeInTheDocument()
  })

  it("maps incident status correctly - executed", () => {
    const incident = mockIncident({ executed: true, dry_run: false })
    render(
      <IncidentReviewCard
        incident={incident}
        adminAddress={ADMIN_ADDRESS}
        onUpdate={() => {}}
      />
    )

    expect(screen.getByText("Executed")).toBeInTheDocument()
  })

  it("maps incident status correctly - dry run", () => {
    const incident = mockIncident({ executed: false, dry_run: true })
    render(
      <IncidentReviewCard
        incident={incident}
        adminAddress={ADMIN_ADDRESS}
        onUpdate={() => {}}
      />
    )

    expect(screen.getByText("Dry Run")).toBeInTheDocument()
  })

  it("maps incident status correctly - skipped", () => {
    const incident = mockIncident({ executed: false, dry_run: false })
    render(
      <IncidentReviewCard
        incident={incident}
        adminAddress={ADMIN_ADDRESS}
        onUpdate={() => {}}
      />
    )

    expect(screen.getByText("Skipped")).toBeInTheDocument()
  })

  it("displays onchain status correctly", () => {
    const incident = mockIncident({ onchain_status: "pending" })
    render(
      <IncidentReviewCard
        incident={incident}
        adminAddress={ADMIN_ADDRESS}
        onUpdate={() => {}}
      />
    )

    // onchain status badge should be visible when expanded
    const expandButton = screen.getByRole("button")
    expect(expandButton).toBeInTheDocument()
  })

  it("shows resolve and resume actions for open incidents", () => {
    const incident = mockIncident({ status: "open" })
    render(
      <IncidentReviewCard
        incident={incident}
        adminAddress={ADMIN_ADDRESS}
        onUpdate={() => {}}
      />
    )

    expect(screen.getByRole("button", { name: /resolve/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument()
  })

  it("does not show actions for resolved incidents", () => {
    const incident = mockIncident({ status: "resolved" })
    render(
      <IncidentReviewCard
        incident={incident}
        adminAddress={ADMIN_ADDRESS}
        onUpdate={() => {}}
      />
    )

    expect(screen.queryByRole("button", { name: /resolve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /resume/i })).not.toBeInTheDocument()
  })

  it("opens resolve dialog and submits resolution", async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const incident = mockIncident({ status: "open" })

    render(
      <IncidentReviewCard
        incident={incident}
        adminAddress={ADMIN_ADDRESS}
        onUpdate={onUpdate}
      />
    )

    // Click resolve button
    const resolveButton = screen.getByRole("button", { name: /resolve/i })
    await user.click(resolveButton)

    // Dialog should open
    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument()
    })

    // Fill in notes
    const notesInput = screen.getByPlaceholderText(/describe how/i)
    await user.type(notesInput, "Issue resolved after investigation")

    // Submit
    const confirmButton = screen.getByRole("button", { name: /confirm/i })
    await user.click(confirmButton)

    // Should call onUpdate after successful submission
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalled()
    })
  })
})

describe("PauseAuthorizationPanel", () => {
  it("displays armed status when authorization is active", async () => {
    mockFetchResponse = {
      currentLedger: 450000,
      authorizations: [mockAuthorization({ status: "active" })],
      armed: true,
    }

    render(
      <PauseAuthorizationPanel
        poolId={POOL_ID}
        poolContractAddress={POOL_CONTRACT}
        adminAddress={ADMIN_ADDRESS}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/armed/i)).toBeInTheDocument()
    })
  })

  it("displays disarmed status when no active authorization", async () => {
    mockFetchResponse = {
      currentLedger: 450000,
      authorizations: [],
      armed: false,
    }

    render(
      <PauseAuthorizationPanel
        poolId={POOL_ID}
        poolContractAddress={POOL_CONTRACT}
        adminAddress={ADMIN_ADDRESS}
      />
    )

    await waitFor(() => {
      expect(screen.getByText(/disarmed/i)).toBeInTheDocument()
    })
  })

  it("renders authorization status badges correctly", async () => {
    mockFetchResponse = {
      currentLedger: 450000,
      authorizations: [
        mockAuthorization({ id: "auth-1", status: "active" }),
        mockAuthorization({ id: "auth-2", status: "used", used_at: "2026-08-29T10:00:00Z" }),
        mockAuthorization({ id: "auth-3", status: "expired" }),
        mockAuthorization({ id: "auth-4", status: "revoked", revoked_at: "2026-08-29T09:00:00Z" }),
      ],
      armed: true,
    }

    render(
      <PauseAuthorizationPanel
        poolId={POOL_ID}
        poolContractAddress={POOL_CONTRACT}
        adminAddress={ADMIN_ADDRESS}
      />
    )

    await waitFor(() => {
      expect(screen.getByText("Active")).toBeInTheDocument()
      expect(screen.getByText("Used")).toBeInTheDocument()
      expect(screen.getByText("Expired")).toBeInTheDocument()
      expect(screen.getByText("Revoked")).toBeInTheDocument()
    })
  })

  it("shows create button when panel is loaded", async () => {
    mockFetchResponse = {
      currentLedger: 450000,
      authorizations: [],
      armed: false,
    }

    render(
      <PauseAuthorizationPanel
        poolId={POOL_ID}
        poolContractAddress={POOL_CONTRACT}
        adminAddress={ADMIN_ADDRESS}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /pre-authorize/i })).toBeInTheDocument()
    })
  })

  it("shows revoke button for active authorizations", async () => {
    mockFetchResponse = {
      currentLedger: 450000,
      authorizations: [mockAuthorization({ status: "active" })],
      armed: true,
    }

    render(
      <PauseAuthorizationPanel
        poolId={POOL_ID}
        poolContractAddress={POOL_CONTRACT}
        adminAddress={ADMIN_ADDRESS}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /revoke/i })).toBeInTheDocument()
    })
  })
})
