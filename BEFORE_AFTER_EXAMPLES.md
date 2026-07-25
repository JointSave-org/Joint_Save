# Before & After: Toast Migration Examples

## Example 1: Transaction Success (group-actions.tsx)

### ❌ Before (Inline State)
```typescript
const [error, setError] = useState("")
const [successMsg, setSuccessMsg] = useState("")

const handleDeposit = async () => {
  setError("")
  setSuccessMsg("")
  if (!address) return setError("Please connect your wallet first")
  
  try {
    // ... transaction logic
    setSuccessMsg("Deposit submitted (confirming on-chain)…")
  } catch (e) {
    setError((e as Error).message)
  }
}

// In JSX:
{error && (
  <div className="flex gap-2 p-3 rounded-lg bg-destructive/10 text-destructive mb-4">
    <AlertCircle className="h-5 w-5 flex-shrink-0" />
    <p className="text-sm">{error}</p>
  </div>
)}

{successMsg && (
  <div className="flex gap-2 p-3 rounded-lg bg-primary/10 text-primary mb-4">
    <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
    <p className="text-sm">{successMsg}</p>
  </div>
)}
```

### ✅ After (Toast System)
```typescript
import { toastManager } from "@/lib/toast"

const handleDeposit = async () => {
  if (!address) return toastManager.error("Please connect your wallet first")
  
  try {
    // ... transaction logic
    toastManager.info("Deposit submitted (confirming on-chain)…")
  } catch (e) {
    toastManager.error((e as Error).message)
  }
}

// No inline error/success divs in JSX!
```

**Benefits:**
- ✅ No local state management
- ✅ Consistent UI across app
- ✅ Auto-dismiss after 6 seconds
- ✅ Toasts stack and don't block content
- ✅ Accessible and keyboard-navigable

## Example 2: Transaction Confirmation with Explorer Link

### ❌ Before
```typescript
useEffect(() => {
  const { pendingTx } = optimisticState
  if (!pendingTx) return

  if (pendingTx.status === "confirmed") {
    toastManager.success(
      `${pendingTx.type.charAt(0).toUpperCase() + pendingTx.type.slice(1)} confirmed ✓`
    )
  }
}, [optimisticState])
```

### ✅ After
```typescript
useEffect(() => {
  const { pendingTx } = optimisticState
  if (!pendingTx) return

  if (pendingTx.status === "confirmed") {
    const txHash = pendingTx.txHash
    toastManager.success(
      `${pendingTx.type.charAt(0).toUpperCase() + pendingTx.type.slice(1)} confirmed ✓`,
      undefined,
      txHash  // 👈 Automatically adds "View on Explorer" button
    )
  }
}, [optimisticState])
```

**Benefits:**
- ✅ One-click transaction verification on Stellar Expert
- ✅ Opens in new tab automatically
- ✅ Network-aware (testnet vs mainnet)

## Example 3: Form Submission Error (flexible-form.tsx)

### ❌ Before
```typescript
const [error, setError] = useState("")
const errorRef = useRef<HTMLDivElement>(null)

useEffect(() => {
  if (error) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
}, [error])

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault()
  setError("")
  
  if (!address) return setError("Please connect your wallet first")
  if (duplicateIndices.size > 0)
    return setError("Duplicate member addresses found")
  
  try {
    // ... form submission
  } catch (err) {
    setError((err as Error).message || "Failed to create group")
  }
}

// In JSX:
{error && (
  <div
    ref={errorRef}
    className="flex gap-2 p-3 rounded-lg bg-destructive/10 text-destructive"
  >
    <AlertCircle className="h-5 w-5 shrink-0" />
    <p className="text-sm">{error}</p>
  </div>
)}
```

### ✅ After
```typescript
import { toastManager } from "@/lib/toast"

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault()
  
  if (!address) return toastManager.error("Please connect your wallet first")
  if (duplicateIndices.size > 0)
    return toastManager.error("Duplicate member addresses found")
  
  try {
    // ... form submission
  } catch (err) {
    toastManager.error((err as Error).message || "Failed to create group")
  }
}

// No error div, no ref, no useEffect!
```

**Benefits:**
- ✅ Less boilerplate code
- ✅ No ref management
- ✅ No scroll handling
- ✅ Toasts appear in consistent location
- ✅ Errors stay visible until dismissed

## Example 4: Admin Actions with Transaction Link

### ❌ Before
```typescript
const handlePause = async () => {
  setError("")
  setSuccessMsg("")
  try {
    const txHash = await pausePool.pause()
    if (txHash) {
      await logAdminAction(groupId, address, "pause", null, txHash)
    }
    setSuccessMsg("Pool paused successfully.")
  } catch (e) {
    setError((e as Error).message || "Transaction failed")
  }
}
```

### ✅ After
```typescript
const handlePause = async () => {
  try {
    const txHash = await pausePool.pause()
    if (txHash) {
      await logAdminAction(groupId, address, "pause", null, txHash)
      toastManager.success("Pool paused successfully", undefined, txHash)
    }
  } catch (e) {
    toastManager.error((e as Error).message || "Transaction failed")
  }
}
```

**Benefits:**
- ✅ Cleaner code flow
- ✅ Transaction hash automatically linked
- ✅ Success message auto-dismisses after 6 seconds
- ✅ Error requires manual dismissal

## Toast Variants Showcase

```typescript
// Success - Green theme, auto-dismiss after 6s, optional tx link
toastManager.success("Transaction confirmed!", undefined, txHash)

// Error - Red theme, requires manual dismissal
toastManager.error("Network connection failed")

// Info - Blue theme, auto-dismiss after 6s
toastManager.info("Processing your request...")

// Warning - Amber theme, auto-dismiss after 6s
toastManager.warning("Pool is approaching capacity limit")

// Custom duration (10 seconds)
toastManager.info("This will show for 10 seconds", 10000)
```

## Visual Differences

### Before: Inline Error
```
┌─────────────────────────────────────────┐
│ ⚠️ Please connect your wallet first    │
│                                         │
│ [Input Field]                          │
│ [Submit Button]                        │
└─────────────────────────────────────────┘
```
- ❌ Takes up space in the layout
- ❌ Can be scrolled out of view
- ❌ Different per component

### After: Toast Notification
```
                    ┌────────────────────────────┐
                    │ ✖ Error                    │
                    │ Please connect wallet first│
                    │              [View Explorer]│
                    └────────────────────────────┘
┌─────────────────────────────────────────────────┐
│ [Input Field]                                   │
│ [Submit Button]                                 │
└─────────────────────────────────────────────────┘
```
- ✅ Floats above content (doesn't shift layout)
- ✅ Always visible in fixed position
- ✅ Consistent across entire app
- ✅ Stacks multiple notifications
- ✅ Auto-dismiss or manual close

## Code Size Reduction

### group-actions.tsx
- **Before:** 2 state variables + 2 inline divs = ~30 lines of error handling
- **After:** Direct toast calls = ~0 lines of UI code
- **Reduction:** ~30 lines removed

### flexible-form.tsx
- **Before:** 1 state + 1 ref + 1 useEffect + 1 inline div = ~20 lines
- **After:** Direct toast calls = ~0 lines of UI code
- **Reduction:** ~20 lines removed

### Total across all 4 components
- **Lines removed:** ~100+ lines
- **Components cleaner:** 4/4
- **Consistency improved:** ✅
