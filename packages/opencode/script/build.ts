#!/usr/bin/env bun
import path from "path"
const dir = new URL("..", import.meta.url).pathname
process.chdir(dir)
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

// Test build - only current platform for now
const targets = [
  ["darwin", "arm64"],
]

// Full targets for production build:
// const targets = [
//   ["windows", "x64"],
//   ["linux", "arm64"],
//   ["linux", "x64"],
//   ["linux", "x64-baseline"],
//   ["darwin", "x64"],
//   ["darwin", "x64-baseline"],
//   ["darwin", "arm64"],
// ]

await $`rm -rf dist`

const binaries: Record<string, string> = {}
for (const [os, arch] of targets) {
  console.log(`Building SnowCode ${os}-${arch}...`)
  const name = `${pkg.name}-${os}-${arch}`
  await $`mkdir -p dist/${name}/bin`

  // Note: TUI component skipped - SnowCode doesn't use Go TUI
  // If needed in future, uncomment and adjust:
  // await $`CGO_ENABLED=0 GOOS=${os} GOARCH=${GOARCH[arch]} go build -ldflags="-s -w -X main.Version=${version}" -o ../opencode/dist/${name}/bin/tui ../tui/cmd/snowcode/main.go`
  //   .cwd("../tui")
  //   .quiet()

  const watcher = `@parcel/watcher-${os === "windows" ? "win32" : os}-${arch.replace("-baseline", "")}${os === "linux" ? "-glibc" : ""}`
  await $`mkdir -p ../../node_modules/${watcher}`
  await $`npm pack ${watcher}`.cwd(path.join(dir, "../../node_modules")).quiet()
  await $`tar -xf ../../node_modules/${watcher.replace("@parcel/", "parcel-")}-*.tgz -C ../../node_modules/${watcher} --strip-components=1`

  await Bun.build({
    sourcemap: "external",
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
