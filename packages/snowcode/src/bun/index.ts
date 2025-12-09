import z from "zod/v4"
import { Global } from "../global"
import { Log } from "../util/log"
import path from "path"
import { NamedError } from "../util/error"
import { readableStreamToText } from "bun"

export namespace BunProc {
  const log = Log.create({ service: "bun" })

  export async function run(cmd: string[], options?: Bun.SpawnOptions.OptionsObject<any, any, any>) {
    log.info("running", {
      cmd: [which(), ...cmd],
      ...options,
    })
    const result = Bun.spawn([which(), ...cmd], {
      ...options,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ...options?.env,
        BUN_BE_BUN: "1",
      },
    })
    const code = await result.exited
    const stdout = result.stdout
      ? typeof result.stdout === "number"
        ? result.stdout
        : await readableStreamToText(result.stdout)
      : undefined
    const stderr = result.stderr
      ? typeof result.stderr === "number"
        ? result.stderr
        : await readableStreamToText(result.stderr)
      : undefined
    log.info("done", {
      code,
      stdout,
      stderr,
    })
    if (code !== 0) {
      throw new Error(`Command failed with exit code ${result.exitCode}`)
    }
    return result
  }

  export function which() {
    return process.execPath
  }

  export const InstallFailedError = NamedError.create(
    "BunInstallFailedError",
    z.object({
      pkg: z.string(),
      version: z.string(),
    }),
  )

  export async function install(pkg: string, version = "latest") {
    const mod = path.join(Global.Path.cache, "node_modules", pkg)
    const pkgjson = Bun.file(path.join(Global.Path.cache, "package.json"))
    const parsed = await pkgjson.json().catch(async () => {
      const result = { dependencies: {} }
      await Bun.write(pkgjson.name!, JSON.stringify(result, null, 2))
      return result
    })
    if (parsed.dependencies[pkg] === version) {
      // Even on cache hit, ensure patches are applied (they may have been reverted)
      await patchSubpathImports(pkg, mod)
      return mod
    }

    // Build command arguments
    const args = ["add", "--force", "--exact", "--cwd", Global.Path.cache, pkg + "@" + version]

    // Let Bun handle registry resolution:
    // - If .npmrc files exist, Bun will use them automatically
    // - If no .npmrc files exist, Bun will default to https://registry.npmjs.org
    // - No need to pass --registry flag
    log.info("installing package using Bun's default registry resolution", { pkg, version })

    await BunProc.run(args, {
      cwd: Global.Path.cache,
    }).catch((e) => {
      throw new InstallFailedError(
        { pkg, version },
        {
          cause: e,
        },
      )
    })
    parsed.dependencies[pkg] = version
    await Bun.write(pkgjson.name!, JSON.stringify(parsed, null, 2))

    // Patch plugins that use subpath imports (Bun doesn't support them in dynamic imports)
    // See: https://github.com/oven-sh/bun/issues/7611
    await patchSubpathImports(pkg, mod)

    return mod
  }

  /**
   * Patches plugin files and their dependencies to resolve module imports that
   * Bun's dynamic import doesn't support from custom paths.
   *
   * Problem: When dynamically importing modules from ~/.cache/snow-code/node_modules/,
   * Bun cannot resolve:
   * 1. Subpath exports (e.g., @openauthjs/openauth/pkce)
   * 2. Transitive dependencies from those modules (e.g., jose imported by pkce.js)
   *
   * Solution: Rewrite all bare module imports to absolute file paths.
   */
  async function patchSubpathImports(pkg: string, modPath: string) {
    // Only patch known plugins that have subpath import issues
    if (!pkg.startsWith("opencode-") || !pkg.includes("-auth")) return

    const cacheNodeModules = path.join(Global.Path.cache, "node_modules")

    // Step 1: Patch the plugin's index.mjs
    const indexFile = Bun.file(path.join(modPath, "index.mjs"))
    if (!(await indexFile.exists())) return

    let content = await indexFile.text()
    let modified = false

    // Pattern: import { X } from "@openauthjs/openauth/pkce"
    // Replace with absolute path
    const subpathPattern = /"@openauthjs\/openauth\/([^"]+)"/g
    content = content.replace(subpathPattern, (_match, subpath) => {
      modified = true
      const absolutePath = path.join(cacheNodeModules, "@openauthjs/openauth/dist/esm", `${subpath}.js`)
      log.info("patching subpath import", { pkg, subpath, absolutePath })
      return `"${absolutePath}"`
    })

    if (modified) {
      await Bun.write(indexFile.name!, content)
      log.info("patched plugin subpath imports", { pkg })
    }

    // Step 2: Patch transitive dependencies in @openauthjs/openauth
    // The pkce.js file imports 'jose' which also can't be resolved
    await patchOpenAuthDependencies(cacheNodeModules)
  }

  /**
   * Patches @openauthjs/openauth files to resolve their bare module imports
   * to absolute paths within the cache directory.
   */
  async function patchOpenAuthDependencies(cacheNodeModules: string) {
    const openAuthEsm = path.join(cacheNodeModules, "@openauthjs/openauth/dist/esm")

    // List of files that need patching and their imports
    const filesToPatch = [
      { file: "pkce.js", imports: { jose: "jose" } },
      { file: "index.js", imports: { jose: "jose", hono: "hono", arctic: "arctic" } },
    ]

    for (const { file, imports } of filesToPatch) {
      const filePath = path.join(openAuthEsm, file)
      const bunFile = Bun.file(filePath)

      if (!(await bunFile.exists())) continue

      let content = await bunFile.text()
      let modified = false

      for (const [importName, pkgName] of Object.entries(imports)) {
        // Find the actual entry point for this package
        const pkgPath = path.join(cacheNodeModules, pkgName)
        const pkgJsonPath = path.join(pkgPath, "package.json")
        const pkgJson = Bun.file(pkgJsonPath)

        if (!(await pkgJson.exists())) continue

        const pkg = await pkgJson.json()
        const entryPoint = pkg.exports?.["."]?.import || pkg.module || pkg.main || "index.js"
        const absolutePath = path.join(pkgPath, entryPoint)

        // Replace bare import with absolute path
        // Handles: import { x } from "jose" and import x from "jose"
        const importPattern = new RegExp(`from\\s+["']${importName}["']`, "g")
        const newContent = content.replace(importPattern, `from "${absolutePath}"`)

        if (newContent !== content) {
          content = newContent
          modified = true
          log.info("patching transitive dependency", { file, importName, absolutePath })
        }
      }

      if (modified) {
        await Bun.write(filePath, content)
        log.info("patched openauth file", { file })
      }
    }
  }
}
