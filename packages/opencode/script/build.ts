#!/usr/bin/env bun
import path from "path"
import { fileURLToPath } from "url"
const dir = path.dirname(fileURLToPath(import.meta.url))
process.chdir(path.resolve(dir, ".."))
import { $ } from "bun"

import pkg from "../package.json"

// SnowCode version from package.json
const version = pkg.version
const channel = "latest"

const GOARCH: Record<string, string> = {
  arm64: "arm64",
  x64: "amd64",
  "x64-baseline": "amd64",
}

// Determine build targets based on environment
// GitHub Actions sets TARGET_OS and TARGET_ARCH for single-platform builds
// Local builds only build current platform to avoid cross-compilation issues
const targets = (() => {
  const targetOS = process.env.TARGET_OS
  const targetArch = process.env.TARGET_ARCH

  // If TARGET_OS/TARGET_ARCH set (GitHub Actions), build that specific platform
  if (targetOS && targetArch) {
    console.log(`Building for specified target: ${targetOS}-${targetArch}`)
    return [[targetOS, targetArch]]
  }

  // Otherwise, build current platform only (local development)
  console.log(`Building for current platform: ${process.platform}-${process.arch}`)
  return [[process.platform, process.arch]]
})()

await $`rm -rf dist`

const binaries: Record<string, string> = {}
for (const [os, arch] of targets) {
  console.log(`Building SnowCode ${os}-${arch}...`)
  const name = `${pkg.name}-${os}-${arch}`
  await $`mkdir -p dist/${name}/bin`

  // Build TUI component (Go binary for interactive interface)
  console.log(`  Building TUI for ${os}-${arch}...`)
  await $`CGO_ENABLED=0 GOOS=${os === "windows" ? "windows" : os} GOARCH=${GOARCH[arch]} go build -ldflags="-s -w -X main.Version=${version}" -o ../opencode/dist/${name}/bin/tui${os === "windows" ? ".exe" : ""} ./cmd/snowcode/main.go`
    .cwd("../tui")
    .quiet()

  const watcher = `@parcel/watcher-${os === "windows" ? "win32" : os}-${arch.replace("-baseline", "")}${os === "linux" ? "-glibc" : ""}`
  await $`mkdir -p ../../node_modules/${watcher}`
  await $`npm pack ${watcher}`.cwd(path.join(dir, "../../node_modules")).quiet()
  await $`tar -xf ../../node_modules/${watcher.replace("@parcel/", "parcel-")}-*.tgz -C ../../node_modules/${watcher} --strip-components=1`

  await Bun.build({
    sourcemap: "external",
    external: ["tree-sitter", "tree-sitter-bash"],
    compile: {
      target: `bun-${os}-${arch}` as any,
      outfile: `dist/${name}/bin/snowcode${os === "windows" ? ".exe" : ""}`,
      execArgv: [`--user-agent=snowcode/${version}`, `--env-file=""`, `--`],
      windows: {},
    },
    entrypoints: ["./src/index.ts"],
    define: {
      SNOWCODE_VERSION: `'${version}'`,
      SNOWCODE_CHANNEL: `'${channel}'`,
    },
  })

  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: version,
        description: `SnowCode platform binary for ${os}-${arch}`,
        os: [os === "windows" ? "win32" : os],
        cpu: [arch === "x64-baseline" ? "x64" : arch],
        bin: {
          snowcode: `./bin/snowcode${os === "windows" ? ".exe" : ""}`,
          opencode: `./bin/snowcode${os === "windows" ? ".exe" : ""}`,
        },
      },
      null,
      2,
    ),
  )
  binaries[name] = version
  console.log(`✅ Built ${name}`)
}

console.log('\n🎉 All SnowCode platform binaries built successfully!')
export { binaries }
