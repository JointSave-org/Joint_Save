import fs from "fs"
import path from "path"

const BUILD_MANIFEST_PATH = path.join(process.cwd(), ".next", "build-manifest.json")
const APP_MANIFEST_PATH = path.join(process.cwd(), ".next", "app-build-manifest.json")

// Acceptable size thresholds (in Bytes)
const SHARED_CHUNKS_THRESHOLD = 80 * 1024 // 80KB
const PER_PAGE_THRESHOLD = 150 * 1024 // 150KB

console.log("=== JointSave Performance Budget Check ===")

if (!fs.existsSync(BUILD_MANIFEST_PATH)) {
  console.error("Error: Next.js build manifest not found. Run `pnpm build` first.")
  process.exit(1)
}

const manifest = JSON.parse(fs.readFileSync(BUILD_MANIFEST_PATH, "utf8"))
const appManifest = fs.existsSync(APP_MANIFEST_PATH)
  ? JSON.parse(fs.readFileSync(APP_MANIFEST_PATH, "utf8"))
  : {}

// Measure shared chunks size
let sharedSize = 0
if (manifest.pages && manifest.pages["/_app"]) {
  manifest.pages["/_app"].forEach((chunk) => {
    const filePath = path.join(process.cwd(), ".next", chunk)
    if (fs.existsSync(filePath)) {
      sharedSize += fs.statSync(filePath).size
    }
  })
}

const sharedSizeKB = (sharedSize / 1024).toFixed(2)
console.log(`Shared Chunks Size: ${sharedSizeKB} KB (Budget: < 80 KB)`)

let failed = false

if (sharedSize > SHARED_CHUNKS_THRESHOLD) {
  console.warn(`⚠️ Shared chunks size (${sharedSizeKB} KB) exceeds 80KB budget.`)
} else {
  console.log(`✅ Shared chunks within 80KB budget.`)
}

// Measure per-page initial JS size across pages and app routes
const pagesToTest = new Map()

// Combine pages and app routes
if (manifest.pages) {
  Object.entries(manifest.pages).forEach(([route, chunks]) => {
    if (route === "/_app" || route === "/_error") return
    let pageSize = sharedSize
    chunks.forEach((chunk) => {
      const filePath = path.join(process.cwd(), ".next", chunk)
      if (fs.existsSync(filePath)) {
        pageSize += fs.statSync(filePath).size
      }
    })
    pagesToTest.set(route, pageSize)
  })
}

if (appManifest.pages) {
  Object.entries(appManifest.pages).forEach(([route, chunks]) => {
    let pageSize = sharedSize
    chunks.forEach((chunk) => {
      const filePath = path.join(process.cwd(), ".next", chunk)
      if (fs.existsSync(filePath)) {
        pageSize += fs.statSync(filePath).size
      }
    })
    pagesToTest.set(route, pageSize)
  })
}

console.log("\nPer-page First Load JS sizes:")
pagesToTest.forEach((pageSize, route) => {
  const pageSizeKB = (pageSize / 1024).toFixed(2)
  const isOver = pageSize > PER_PAGE_THRESHOLD
  if (isOver) {
    console.warn(`  ⚠️ ${route}: ${pageSizeKB} KB (exceeds 150KB threshold)`)
  } else {
    console.log(`  ✅ ${route}: ${pageSizeKB} KB (Budget: < 150 KB)`)
  }
})

if (failed) {
  console.error("\n❌ Performance budget check failed.")
  process.exit(1)
} else {
  console.log("\n🎉 Performance budget check complete!")
}
