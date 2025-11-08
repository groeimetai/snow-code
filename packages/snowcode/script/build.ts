#!/usr/bin/env bun
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const dir = path.resolve(__dirname, "..")

process.chdir(dir)
import { $ } from "bun"

import pkg from "../package.json"
import { Script } from "@opencode-ai/script"

const GOARCH: Record<string, string> = {
  arm64: "arm64",
  x64: "amd64",
  "x64-baseline": "amd64",
}

// Check if we should build for a specific platform (from GitHub Actions)
const targetOS = process.env.TARGET_OS
const targetArch = process.env.TARGET_ARCH

const allTargets = [
  ["windows", "x64"],
  ["linux", "arm64"],
  ["linux", "x64"],
  ["linux", "x64-baseline"],
  ["darwin", "x64"],
  ["darwin", "x64-baseline"],
  ["darwin", "arm64"],
]

// If TARGET_OS and TARGET_ARCH are set, only build that platform
const targets = targetOS && targetArch
  ? [[targetOS, targetArch]]
  : allTargets

await $`rm -rf dist`

const binaries: Record<string, string> = {}
for (const [os, arch] of targets) {
  console.log(`building ${os}-${arch}`)
  const name = `${pkg.name}-${os}-${arch}`
  await $`mkdir -p dist/${name}/bin`
  await $`CGO_ENABLED=0 GOOS=${os} GOARCH=${GOARCH[arch]} go build -ldflags="-s -w -X main.Version=${pkg.version}" -o ../opencode/dist/${name}/bin/tui ../tui/cmd/opencode/main.go`
    .cwd("../tui")
    .quiet()

  const watcher = `@parcel/watcher-${os === "windows" ? "win32" : os}-${arch.replace("-baseline", "")}${os === "linux" ? "-glibc" : ""}`
  await $`mkdir -p ../../node_modules/${watcher}`
  await $`npm pack npm pack ${watcher}`.cwd(path.join(dir, "../../node_modules")).quiet()
  await $`tar -xf ../../node_modules/${watcher.replace("@parcel/", "parcel-")}-*.tgz -C ../../node_modules/${watcher} --strip-components=1`

  await Bun.build({
    sourcemap: "external",
    compile: {
      target: `bun-${os}-${arch}` as any,
      outfile: `dist/${name}/bin/snow-code`,
      execArgv: [`--user-agent=snowcode/${pkg.version}`, `--env-file=""`, `--`],
      windows: {},
    },
    entrypoints: ["./src/index.ts"],
    define: {
      SNOWCODE_VERSION: `'${pkg.version}'`,  // Use package.json version
      SNOWCODE_CHANNEL: `'${Script.channel}'`,
      SNOWCODE_TUI_PATH: `'../../../dist/${name}/bin/tui'`,
    },
  })

  // Make binary executable (non-Windows platforms)
  if (os !== "windows") {
    await $`chmod +x dist/${name}/bin/snow-code`
  }

  await $`rm -rf ./dist/${name}/bin/tui`
  await Bun.file(`dist/${name}/package.json`).write(
    JSON.stringify(
      {
        name,
        version: pkg.version,  // Use package.json version, not Script.version
        os: [os === "windows" ? "win32" : os],
        cpu: [arch],
      },
      null,
      2,
    ),
  )
  binaries[name] = pkg.version
}

export { binaries }
