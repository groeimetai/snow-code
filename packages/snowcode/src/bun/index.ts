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
    const modDir = path.join(Global.Path.cache, "node_modules", pkg)
    const cachePkgJson = Bun.file(path.join(Global.Path.cache, "package.json"))
    const parsed = await cachePkgJson.json().catch(async () => {
      const result = { dependencies: {} }
      await Bun.write(cachePkgJson.name!, JSON.stringify(result, null, 2))
      return result
    })

    // Install if not already installed with this version OR if module directory doesn't exist
    const modExists = await Bun.file(path.join(modDir, "package.json")).exists()
    if (parsed.dependencies[pkg] !== version || !modExists) {
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
      await Bun.write(cachePkgJson.name!, JSON.stringify(parsed, null, 2))
    }

    // Resolve the actual entry point from the module's package.json
    const modPkgJsonPath = path.join(modDir, "package.json")
    const modPkgJson = Bun.file(modPkgJsonPath)
    const modPkg = (await modPkgJson.json().catch(() => ({}))) as {
      main?: string
      exports?: string | Record<string, string | { import?: string; require?: string; default?: string }>
    }

    // Determine entry point: check exports["."], then main, then default to index.js
    let entryPoint = "index.js"
    if (modPkg.exports) {
      if (typeof modPkg.exports === "string") {
        // exports: "./index.js"
        entryPoint = modPkg.exports
      } else if (modPkg.exports["."]) {
        const dotExport = modPkg.exports["."]
        if (typeof dotExport === "string") {
          // exports: { ".": "./index.js" }
          entryPoint = dotExport
        } else if (typeof dotExport === "object") {
          // exports: { ".": { "import": "./index.mjs", "require": "./index.cjs" } }
          entryPoint = dotExport.import || dotExport.default || dotExport.require || "index.js"
        }
      }
    } else if (modPkg.main) {
      entryPoint = modPkg.main
    }

    // Return the full path to the entry point
    const resolvedPath = path.join(modDir, entryPoint)
    log.info("resolved module entry point", { pkg, entryPoint, resolvedPath })
    return resolvedPath
  }
}
