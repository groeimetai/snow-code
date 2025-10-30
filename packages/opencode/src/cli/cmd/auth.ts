import { Auth } from "../../auth"
import { cmd } from "./cmd"
import * as prompts from "@clack/prompts"
import { UI } from "../ui"
import { ModelsDev } from "../../provider/models"
import { map, pipe, sortBy, values } from "remeda"
import path from "path"
import os from "os"
import { Global } from "../../global"
import { Plugin } from "../../plugin"
import { Instance } from "../../project/instance"
import { Config } from "../../config/config"
import { ServiceNowOAuth } from "../../auth/servicenow-oauth"

export const AuthCommand = cmd({
  command: "auth",
  describe: "manage credentials",
  builder: (yargs) =>
    yargs.command(AuthLoginCommand).command(AuthLogoutCommand).command(AuthListCommand).demandCommand(),
  async handler() {},
})

export const AuthListCommand = cmd({
  command: "list",
  aliases: ["ls"],
  describe: "list providers",
  async handler() {
    UI.empty()
    const authPath = path.join(Global.Path.data, "auth.json")
    const homedir = os.homedir()
    const displayPath = authPath.startsWith(homedir) ? authPath.replace(homedir, "~") : authPath
    prompts.intro(`Credentials ${UI.Style.TEXT_DIM}${displayPath}`)
    const results = await Auth.all().then((x) => Object.entries(x))
    const database = await ModelsDev.get()

    for (const [providerID, result] of results) {
      const name = database[providerID]?.name || providerID
      prompts.log.info(`${name} ${UI.Style.TEXT_DIM}${result.type}`)
    }

    prompts.outro(`${results.length} credentials`)

    // Environment variables section
    const activeEnvVars: Array<{ provider: string; envVar: string }> = []

    for (const [providerID, provider] of Object.entries(database)) {
      for (const envVar of provider.env) {
        if (process.env[envVar]) {
          activeEnvVars.push({
            provider: provider.name || providerID,
            envVar,
          })
        }
      }
    }

    if (activeEnvVars.length > 0) {
      UI.empty()
      prompts.intro("Environment")

      for (const { provider, envVar } of activeEnvVars) {
        prompts.log.info(`${provider} ${UI.Style.TEXT_DIM}${envVar}`)
      }

      prompts.outro(`${activeEnvVars.length} environment variable` + (activeEnvVars.length === 1 ? "" : "s"))
    }
  },
})

export const AuthLoginCommand = cmd({
  command: "login [url]",
  describe: "log in to a provider",
  builder: (yargs) =>
    yargs.positional("url", {
      describe: "opencode auth provider",
      type: "string",
    }),
  async handler(args) {
    await Instance.provide({
      directory: process.cwd(),
      async fn() {
        UI.empty()
        prompts.intro("Add credential")
        if (args.url) {
          const wellknown = await fetch(`${args.url}/.well-known/opencode`).then((x) => x.json())
          prompts.log.info(`Running \`${wellknown.auth.command.join(" ")}\``)
          const proc = Bun.spawn({
            cmd: wellknown.auth.command,
            stdout: "pipe",
          })
          const exit = await proc.exited
          if (exit !== 0) {
            prompts.log.error("Failed")
            prompts.outro("Done")
            await Instance.dispose()
            return
          }
          const token = await new Response(proc.stdout).text()
          await Auth.set(args.url, {
            type: "wellknown",
            key: wellknown.auth.env,
            token: token.trim(),
          })
          prompts.log.success("Logged into " + args.url)
          prompts.outro("Done")
          await Instance.dispose()
          return
        }
        await ModelsDev.refresh().catch(() => {})
        const providers = await ModelsDev.get()
        const priority: Record<string, number> = {
          opencode: 0,
          anthropic: 1,
          "github-copilot": 2,
          openai: 3,
          google: 4,
          openrouter: 5,
          vercel: 6,
        }
        let provider = await prompts.autocomplete({
          message: "Select provider",
          maxItems: 10,
          options: [
            {
              value: "servicenow",
              label: "ServiceNow (OAuth)",
              hint: "recommended for Snow-Flow",
            },
            ...pipe(
              providers,
              values(),
              sortBy(
                (x) => priority[x.id] ?? 99,
                (x) => x.name ?? x.id,
              ),
              map((x) => ({
                label: x.name,
                value: x.id,
                hint: priority[x.id] <= 1 ? "recommended" : undefined,
              })),
            ),
            {
              value: "enterprise",
              label: "Snow-Flow Enterprise",
            },
            {
              value: "other",
              label: "Other",
            },
          ],
        })

        if (prompts.isCancel(provider)) throw new UI.CancelledError()

        // Handle ServiceNow authentication
        if (provider === "servicenow") {
          prompts.log.step("ServiceNow Authentication")

          const instance = (await prompts.text({
            message: "ServiceNow instance URL",
            placeholder: "dev12345.service-now.com",
            validate: (value) => {
              if (!value || value.trim() === "") return "Instance URL is required"
              const cleaned = value.replace(/^https?:\/\//, "").replace(/\/$/, "")
              if (
                !cleaned.includes(".service-now.com") &&
                !cleaned.includes("localhost") &&
                !cleaned.includes("127.0.0.1")
              ) {
                return "Must be a ServiceNow domain (e.g., dev12345.service-now.com)"
              }
            },
          })) as string

          if (prompts.isCancel(instance)) throw new UI.CancelledError()

          const authMethod = (await prompts.select({
            message: "Authentication method",
            options: [
              { value: "oauth", label: "OAuth 2.0", hint: "recommended" },
              { value: "basic", label: "Basic Auth", hint: "username/password" },
            ],
          })) as string

          if (prompts.isCancel(authMethod)) throw new UI.CancelledError()

          if (authMethod === "oauth") {
            const clientId = (await prompts.text({
              message: "OAuth Client ID",
              placeholder: "32-character hex string from ServiceNow",
              validate: (value) => {
                if (!value || value.trim() === "") return "Client ID is required"
                if (value.length < 32) return "Client ID too short (expected 32+ characters)"
              },
            })) as string

            if (prompts.isCancel(clientId)) throw new UI.CancelledError()

            const clientSecret = (await prompts.password({
              message: "OAuth Client Secret",
              validate: (value) => {
                if (!value || value.trim() === "") return "Client Secret is required"
                if (value.length < 32) return "Client Secret too short (expected 32+ characters)"
              },
            })) as string

            if (prompts.isCancel(clientSecret)) throw new UI.CancelledError()

            // Run full OAuth flow
            const oauth = new ServiceNowOAuth()
            const result = await oauth.authenticate({
              instance,
              clientId,
              clientSecret,
            })

            if (result.success) {
              prompts.log.success("ServiceNow authentication successful")
            } else {
              prompts.log.error(`Authentication failed: ${result.error}`)
            }
          } else {
            // Basic auth
            const username = (await prompts.text({
              message: "ServiceNow username",
              placeholder: "admin",
              validate: (value) => {
                if (!value || value.trim() === "") return "Username is required"
              },
            })) as string

            if (prompts.isCancel(username)) throw new UI.CancelledError()

            const password = (await prompts.password({
              message: "ServiceNow password",
              validate: (value) => {
                if (!value || value.trim() === "") return "Password is required"
              },
            })) as string

            if (prompts.isCancel(password)) throw new UI.CancelledError()

            // Save to Auth store
            await Auth.set("servicenow", {
              type: "servicenow-basic",
              instance,
              username,
              password,
            })

            prompts.log.success("ServiceNow credentials saved")
          }

          // After ServiceNow setup, ask about Enterprise (optional)
          prompts.log.message("")
          const configureEnterprise = await prompts.confirm({
            message: "Configure Snow-Flow Enterprise? (optional)",
            initialValue: false,
          })

          if (prompts.isCancel(configureEnterprise) || !configureEnterprise) {
            prompts.outro("Done")
            await Instance.dispose()
            return
          }

          // User wants Enterprise, set provider and fall through
          prompts.log.message("")
          provider = "enterprise"
          // Fall through to Enterprise handler below
        }

        // Handle Enterprise authentication
        if (provider === "enterprise") {
          prompts.log.step("Snow-Flow Enterprise Setup")

          const licenseKey = (await prompts.password({
            message: "Enterprise License Key (format: SNOW-ENT-*-*)",
            validate: (value) => {
              if (!value || value.trim() === "") return "License key is required"
              if (!value.startsWith("SNOW-ENT-")) return "Invalid license key format (should start with SNOW-ENT-)"
            },
          })) as string

          if (prompts.isCancel(licenseKey)) throw new UI.CancelledError()

          const enterpriseUrl = (await prompts.text({
            message: "Enterprise License Server URL (optional)",
            placeholder: "https://license.snow-flow.dev",
            initialValue: "https://license.snow-flow.dev",
          })) as string

          if (prompts.isCancel(enterpriseUrl)) throw new UI.CancelledError()

          // Optional integrations
          const configureIntegrations = await prompts.confirm({
            message: "Configure optional integrations (Jira, Azure DevOps)?",
            initialValue: false,
          })

          let jiraBaseUrl: string | undefined
          let jiraEmail: string | undefined
          let jiraApiToken: string | undefined

          if (!prompts.isCancel(configureIntegrations) && configureIntegrations) {
            jiraBaseUrl = (await prompts.text({
              message: "Jira Base URL (optional)",
              placeholder: "https://company.atlassian.net",
            })) as string

            if (!prompts.isCancel(jiraBaseUrl) && jiraBaseUrl) {
              jiraEmail = (await prompts.text({
                message: "Jira Email",
                placeholder: "admin@company.com",
              })) as string

              if (!prompts.isCancel(jiraEmail)) {
                jiraApiToken = (await prompts.password({
                  message: "Jira API Token",
                })) as string
              }
            }
          }

          // Save to Auth store
          await Auth.set("enterprise", {
            type: "enterprise",
            licenseKey,
            enterpriseUrl: enterpriseUrl || undefined,
            jiraBaseUrl: jiraBaseUrl || undefined,
            jiraEmail: jiraEmail || undefined,
            jiraApiToken: jiraApiToken || undefined,
          })

          prompts.log.success("Enterprise configuration saved")
          prompts.outro("Done")
          await Instance.dispose()
          return
        }

        // Model selection step - integrated into the auth flow
        let selectedModel: string | undefined
        if (
          provider !== "other" &&
          provider !== "amazon-bedrock" &&
          provider !== "google-vertex" &&
          provider !== "servicenow" &&
          provider !== "enterprise"
        ) {
          const providerData = providers[provider]
          if (providerData && providerData.models && Object.keys(providerData.models).length > 0) {
            const modelOptions = pipe(
              providerData.models,
              values(),
              sortBy(
                (x) => (x.status === "alpha" || x.status === "beta" ? 1 : 0),
                (x) => -x.release_date,
              ),
              map((model) => {
                const contextWindow = model.limit.context ? ` (${(model.limit.context / 1000).toFixed(0)}K context)` : ""
                const status = model.status ? ` [${model.status}]` : ""
                return {
                  label: model.name + contextWindow + status,
                  value: model.id,
                  hint: model.experimental ? "experimental" : undefined,
                }
              }),
            )

            if (modelOptions.length > 0) {
              const modelChoice = await prompts.autocomplete({
                message: `Select default model for ${providerData.name}`,
                maxItems: 10,
                options: modelOptions,
              })

              if (!prompts.isCancel(modelChoice)) {
                selectedModel = `${provider}/${modelChoice}`
                prompts.log.success(`Default model: ${providerData.models[modelChoice]?.name}`)
              }
            }
          }
        }

        const plugin = await Plugin.list().then((x) => x.find((x) => x.auth?.provider === provider))
        if (plugin && plugin.auth) {
          let index = 0
          if (plugin.auth.methods.length > 1) {
            const method = await prompts.select({
              message: "Login method",
              options: [
                ...plugin.auth.methods.map((x, index) => ({
                  label: x.label,
                  value: index.toString(),
                })),
              ],
            })
            if (prompts.isCancel(method)) throw new UI.CancelledError()
            index = parseInt(method)
          }
          const method = plugin.auth.methods[index]
          if (method.type === "oauth") {
            await new Promise((resolve) => setTimeout(resolve, 10))
            const authorize = await method.authorize()

            if (authorize.url) {
              prompts.log.info("Go to: " + authorize.url)
            }

            if (authorize.method === "auto") {
              if (authorize.instructions) {
                prompts.log.info(authorize.instructions)
              }
              const spinner = prompts.spinner()
              spinner.start("Waiting for authorization...")
              const result = await authorize.callback()
              if (result.type === "failed") {
                spinner.stop("Failed to authorize", 1)
              }
              if (result.type === "success") {
                if ("refresh" in result) {
                  await Auth.set(provider, {
                    type: "oauth",
                    refresh: result.refresh,
                    access: result.access,
                    expires: result.expires,
                  })
                }
                if ("key" in result) {
                  await Auth.set(provider, {
                    type: "api",
                    key: result.key,
                  })
                }
                spinner.stop("Login successful")
              }
            }

            if (authorize.method === "code") {
              const code = await prompts.text({
                message: "Paste the authorization code here: ",
                validate: (x) => (x && x.length > 0 ? undefined : "Required"),
              })
              if (prompts.isCancel(code)) throw new UI.CancelledError()
              const result = await authorize.callback(code)
              if (result.type === "failed") {
                prompts.log.error("Failed to authorize")
              }
              if (result.type === "success") {
                if ("refresh" in result) {
                  await Auth.set(provider, {
                    type: "oauth",
                    refresh: result.refresh,
                    access: result.access,
                    expires: result.expires,
                  })
                }
                if ("key" in result) {
                  await Auth.set(provider, {
                    type: "api",
                    key: result.key,
                  })
                }
                prompts.log.success("Login successful")
              }
            }

            // Save selected model to config if chosen
            if (selectedModel) {
              try {
                await Config.update({ model: selectedModel })
                prompts.log.info(`Saved default model: ${selectedModel}`)
              } catch (err) {
                prompts.log.warn("Could not save model preference to config")
              }
            }

            // Automatically continue to ServiceNow setup (required for snow-flow)
            prompts.log.message("")
            prompts.log.step("ServiceNow Configuration")
            prompts.log.info("Snow-Flow requires ServiceNow connection for development")
            prompts.log.message("")

            // Run ServiceNow setup directly (handler was already passed earlier)
            const snowInstance = (await prompts.text({
              message: "ServiceNow instance URL",
              placeholder: "dev12345.service-now.com",
              validate: (value) => {
                if (!value || value.trim() === "") return "Instance URL is required"
                const cleaned = value.replace(/^https?:\/\//, "").replace(/\/$/, "")
                if (
                  !cleaned.includes(".service-now.com") &&
                  !cleaned.includes("localhost") &&
                  !cleaned.includes("127.0.0.1")
                ) {
                  return "Must be a ServiceNow domain (e.g., dev12345.service-now.com)"
                }
              },
            })) as string

            if (prompts.isCancel(snowInstance)) {
              prompts.outro("Done")
              await Instance.dispose()
              return
            }

            const snowAuthMethod = (await prompts.select({
              message: "Authentication method",
              options: [
                { value: "oauth", label: "OAuth 2.0", hint: "recommended" },
                { value: "basic", label: "Basic Auth", hint: "username/password" },
              ],
            })) as string

            if (prompts.isCancel(snowAuthMethod)) {
              prompts.outro("Done")
              await Instance.dispose()
              return
            }

            if (snowAuthMethod === "oauth") {
              const snowClientId = (await prompts.text({
                message: "OAuth Client ID",
                placeholder: "32-character hex string from ServiceNow",
                validate: (value) => {
                  if (!value || value.trim() === "") return "Client ID is required"
                  if (value.length < 32) return "Client ID too short (expected 32+ characters)"
                },
              })) as string

              if (prompts.isCancel(snowClientId)) {
                prompts.outro("Done")
                await Instance.dispose()
                return
              }

              const snowClientSecret = (await prompts.password({
                message: "OAuth Client Secret",
                validate: (value) => {
                  if (!value || value.trim() === "") return "Client Secret is required"
                  if (value.length < 32) return "Client Secret too short (expected 32+ characters)"
                },
              })) as string

              if (prompts.isCancel(snowClientSecret)) {
                prompts.outro("Done")
                await Instance.dispose()
                return
              }

              // Run full OAuth flow
              const oauth = new ServiceNowOAuth()
              const result = await oauth.authenticate({
                instance: snowInstance,
                clientId: snowClientId,
                clientSecret: snowClientSecret,
              })

              if (result.success) {
                prompts.log.success("ServiceNow authentication successful")
              } else {
                prompts.log.error(`Authentication failed: ${result.error}`)
              }
            } else {
              // Basic auth
              const snowUsername = (await prompts.text({
                message: "ServiceNow username",
                placeholder: "admin",
                validate: (value) => {
                  if (!value || value.trim() === "") return "Username is required"
                },
              })) as string

              if (prompts.isCancel(snowUsername)) {
                prompts.outro("Done")
                await Instance.dispose()
                return
              }

              const snowPassword = (await prompts.password({
                message: "ServiceNow password",
                validate: (value) => {
                  if (!value || value.trim() === "") return "Password is required"
                },
              })) as string

              if (prompts.isCancel(snowPassword)) {
                prompts.outro("Done")
                await Instance.dispose()
                return
              }

              // Save to Auth store
              await Auth.set("servicenow", {
                type: "servicenow-basic",
                instance: snowInstance,
                username: snowUsername,
                password: snowPassword,
              })

              prompts.log.success("ServiceNow credentials saved")
            }

            // After ServiceNow setup, ask about Enterprise (optional)
            prompts.log.message("")
            const configureEnterpriseAfterLLM = await prompts.confirm({
              message: "Configure Snow-Flow Enterprise? (optional)",
              initialValue: false,
            })

            if (prompts.isCancel(configureEnterpriseAfterLLM) || !configureEnterpriseAfterLLM) {
              prompts.outro("Done")
              await Instance.dispose()
              return
            }

            // User wants Enterprise - handle it directly
            prompts.log.message("")
            prompts.log.step("Snow-Flow Enterprise Setup")

            const enterpriseLicenseKey = (await prompts.password({
              message: "Enterprise License Key (format: SNOW-ENT-*-*)",
              validate: (value) => {
                if (!value || value.trim() === "") return "License key is required"
                if (!value.startsWith("SNOW-ENT-")) return "Invalid license key format (should start with SNOW-ENT-)"
              },
            })) as string

            if (prompts.isCancel(enterpriseLicenseKey)) {
              prompts.outro("Done")
              await Instance.dispose()
              return
            }

            const enterpriseServerUrl = (await prompts.text({
              message: "Enterprise License Server URL (optional)",
              placeholder: "https://license.snow-flow.dev",
              initialValue: "https://license.snow-flow.dev",
            })) as string

            if (prompts.isCancel(enterpriseServerUrl)) {
              prompts.outro("Done")
              await Instance.dispose()
              return
            }

            // Optional integrations
            const configureJira = await prompts.confirm({
              message: "Configure optional integrations (Jira, Azure DevOps)?",
              initialValue: false,
            })

            let enterpriseJiraBaseUrl: string | undefined
            let enterpriseJiraEmail: string | undefined
            let enterpriseJiraApiToken: string | undefined

            if (!prompts.isCancel(configureJira) && configureJira) {
              enterpriseJiraBaseUrl = (await prompts.text({
                message: "Jira Base URL (optional)",
                placeholder: "https://company.atlassian.net",
              })) as string

              if (!prompts.isCancel(enterpriseJiraBaseUrl) && enterpriseJiraBaseUrl) {
                enterpriseJiraEmail = (await prompts.text({
                  message: "Jira Email",
                  placeholder: "admin@company.com",
                })) as string

                if (!prompts.isCancel(enterpriseJiraEmail)) {
                  enterpriseJiraApiToken = (await prompts.password({
                    message: "Jira API Token",
                  })) as string
                }
              }
            }

            // Save Enterprise config to Auth store
            await Auth.set("enterprise", {
              type: "enterprise",
              licenseKey: enterpriseLicenseKey,
              enterpriseUrl: enterpriseServerUrl || undefined,
              jiraBaseUrl: enterpriseJiraBaseUrl || undefined,
              jiraEmail: enterpriseJiraEmail || undefined,
              jiraApiToken: enterpriseJiraApiToken || undefined,
            })

            prompts.log.success("Enterprise configuration saved")
            prompts.outro("Done")
            await Instance.dispose()
            return
          }
        }

        if (provider === "other") {
          provider = await prompts.text({
            message: "Enter provider id",
            validate: (x) => (x && x.match(/^[0-9a-z-]+$/) ? undefined : "a-z, 0-9 and hyphens only"),
          })
          if (prompts.isCancel(provider)) throw new UI.CancelledError()
          provider = provider.replace(/^@ai-sdk\//, "")
          if (prompts.isCancel(provider)) throw new UI.CancelledError()
          prompts.log.warn(
            `This only stores a credential for ${provider} - you will need configure it in opencode.json, check the docs for examples.`,
          )
        }

        if (provider === "amazon-bedrock") {
          prompts.log.info(
            "Amazon bedrock can be configured with standard AWS environment variables like AWS_BEARER_TOKEN_BEDROCK, AWS_PROFILE or AWS_ACCESS_KEY_ID",
          )
          prompts.outro("Done")
          await Instance.dispose()
          return
        }

        if (provider === "google-vertex") {
          prompts.log.info(
            "Google Cloud Vertex AI uses Application Default Credentials. Set GOOGLE_APPLICATION_CREDENTIALS or run 'gcloud auth application-default login'. Optionally set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION (or VERTEX_LOCATION)",
          )
          prompts.outro("Done")
          await Instance.dispose()
          return
        }

        if (provider === "opencode") {
          prompts.log.info("Create an api key at https://opencode.ai/auth")
        }

        if (provider === "vercel") {
          prompts.log.info("You can create an api key at https://vercel.link/ai-gateway-token")
        }

        const key = await prompts.password({
          message: "Enter your API key",
          validate: (x) => (x && x.length > 0 ? undefined : "Required"),
        })
        if (prompts.isCancel(key)) throw new UI.CancelledError()
        await Auth.set(provider, {
          type: "api",
          key,
        })

        // Save selected model to config if chosen
        if (selectedModel) {
          try {
            await Config.update({ model: selectedModel })
            prompts.log.info(`Saved default model: ${selectedModel}`)
          } catch (err) {
            prompts.log.warn("Could not save model preference to config")
          }
        }

        prompts.outro("Done")
        await Instance.dispose()
      },
    })
  },
})

export const AuthLogoutCommand = cmd({
  command: "logout",
  describe: "log out from a configured provider",
  async handler() {
    UI.empty()
    const credentials = await Auth.all().then((x) => Object.entries(x))
    prompts.intro("Remove credential")
    if (credentials.length === 0) {
      prompts.log.error("No credentials found")
      return
    }
    const database = await ModelsDev.get()
    const providerID = await prompts.select({
      message: "Select provider",
      options: credentials.map(([key, value]) => ({
        label: (database[key]?.name || key) + UI.Style.TEXT_DIM + " (" + value.type + ")",
        value: key,
      })),
    })
    if (prompts.isCancel(providerID)) throw new UI.CancelledError()
    await Auth.remove(providerID)
    prompts.outro("Logout successful")
  },
})
