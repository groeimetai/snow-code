import path from "path"
import { Global } from "../global"
import fs from "fs/promises"
import z from "zod/v4"

export namespace Auth {
  export const Oauth = z
    .object({
      type: z.literal("oauth"),
      refresh: z.string(),
      access: z.string(),
      expires: z.number(),
    })
    .meta({ ref: "OAuth" })

  export const Api = z
    .object({
      type: z.literal("api"),
      key: z.string(),
    })
    .meta({ ref: "ApiAuth" })

  export const WellKnown = z
    .object({
      type: z.literal("wellknown"),
      key: z.string(),
      token: z.string(),
    })
    .meta({ ref: "WellKnownAuth" })

  export const ServiceNowOAuth = z
    .object({
      type: z.literal("servicenow-oauth"),
      instance: z.string(),
      clientId: z.string(),
      clientSecret: z.string(),
      accessToken: z.string().optional(),
      refreshToken: z.string().optional(),
      expiresAt: z.number().optional(),
    })
    .meta({ ref: "ServiceNowOAuth" })

  export const ServiceNowBasic = z
    .object({
      type: z.literal("servicenow-basic"),
      instance: z.string(),
      username: z.string(),
      password: z.string(),
    })
    .meta({ ref: "ServiceNowBasic" })

  export const Enterprise = z
    .object({
      type: z.literal("enterprise"),
      licenseKey: z.string(),
      enterpriseUrl: z.string().optional(),
      jiraBaseUrl: z.string().optional(),
      jiraEmail: z.string().optional(),
      jiraApiToken: z.string().optional(),
    })
    .meta({ ref: "Enterprise" })

  export const Info = z
    .discriminatedUnion("type", [Oauth, Api, WellKnown, ServiceNowOAuth, ServiceNowBasic, Enterprise])
    .meta({ ref: "Auth" })
  export type Info = z.infer<typeof Info>

  const filepath = path.join(Global.Path.data, "auth.json")

  export async function get(providerID: string) {
    const file = Bun.file(filepath)
    return file
      .json()
      .catch(() => ({}))
      .then((x) => x[providerID] as Info | undefined)
  }

  export async function all(): Promise<Record<string, Info>> {
    const file = Bun.file(filepath)
    return file.json().catch(() => ({}))
  }

  export async function set(key: string, info: Info) {
    const file = Bun.file(filepath)
    const data = await all()
    await Bun.write(file, JSON.stringify({ ...data, [key]: info }, null, 2))
    await fs.chmod(file.name!, 0o600)
  }

  export async function remove(key: string) {
    const file = Bun.file(filepath)
    const data = await all()
    delete data[key]
    await Bun.write(file, JSON.stringify(data, null, 2))
    await fs.chmod(file.name!, 0o600)
  }
}
