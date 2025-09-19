import type { Message, Agent, Provider, Session, Part, Config, Todo } from "@opencode-ai/sdk"
import { createStore, produce, reconcile } from "solid-js/store"
import { useSDK } from "./sdk"
import { createContext, Show, useContext, type ParentProps } from "solid-js"
import { Binary } from "../../../../util/binary"

function init() {
  const [store, setStore] = createStore<{
    ready: boolean
    provider: Provider[]
    agent: Agent[]
    config: Config
    session: Session[]
    todo: {
      [sessionID: string]: Todo[]
    }
    message: {
      [sessionID: string]: Message[]
    }
    part: {
      [messageID: string]: Part[]
    }
  }>({
    config: {},
    ready: false,
    agent: [],
    provider: [],
    session: [],
    todo: {},
    message: {},
    part: {},
  })

  const sdk = useSDK()

  sdk.event.subscribe().then(async (events) => {
    for await (const event of events.stream) {
      switch (event.type) {
        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break
        case "session.updated":
          const result = Binary.search(store.session, event.properties.info.id, (s) => s.id)
          if (result.found) {
            setStore("session", result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        case "message.updated": {
          const messages = store.message[event.properties.info.sessionID]
          if (!messages) {
            setStore("message", event.properties.info.sessionID, [event.properties.info])
            break
          }
          const result = Binary.search(messages, event.properties.info.id, (m) => m.id)
          if (result.found) {
            setStore("message", event.properties.info.sessionID, result.index, reconcile(event.properties.info))
            break
          }
          setStore(
            "message",
            event.properties.info.sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          break
        }
        case "message.part.updated": {
          const parts = store.part[event.properties.part.messageID]
          if (!parts) {
            setStore("part", event.properties.part.messageID, [event.properties.part])
            break
          }
          const result = Binary.search(parts, event.properties.part.id, (p) => p.id)
          if (result.found) {
            setStore("part", event.properties.part.messageID, result.index, reconcile(event.properties.part))
            break
          }
          setStore(
            "part",
            event.properties.part.messageID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.part)
            }),
          )
          break
        }
      }
    }
  })

  Promise.all([
    sdk.config.providers().then((x) => setStore("provider", x.data!.providers)),
    sdk.app.agents().then((x) => setStore("agent", x.data ?? [])),
    sdk.session.list().then((x) => setStore("session", x.data ?? [])),
    sdk.config.get().then((x) => setStore("config", x.data!)),
  ]).then(() => setStore("ready", true))

  return {
    data: store,
    set: setStore,
    session: {
      get(sessionID: string) {
        const match = Binary.search(store.session, sessionID, (s) => s.id)
        if (match.found) return store.session[match.index]
        return undefined
      },
      async sync(sessionID: string) {
        const [session, messages, todo] = await Promise.all([
          sdk.session.get({ path: { id: sessionID } }),
          sdk.session.messages({ path: { id: sessionID } }),
          sdk.session.todo({ path: { id: sessionID } }),
        ])
        setStore(
          produce((draft) => {
            const match = Binary.search(draft.session, sessionID, (s) => s.id)
            draft.session[match.index] = session.data!
            draft.todo[sessionID] = todo.data ?? []
            draft.message[sessionID] = messages.data!.map((x) => x.info)
            for (const message of messages.data!) {
              draft.part[message.info.id] = message.parts
            }
          }),
        )
      },
    },
  }
}

type SyncContext = ReturnType<typeof init>

const ctx = createContext<SyncContext>()

export function SyncProvider(props: ParentProps) {
  const value = init()
  return (
    <Show when={value.data.ready}>
      <ctx.Provider value={value}>{props.children}</ctx.Provider>
    </Show>
  )
}

export function useSync() {
  const value = useContext(ctx)
  if (!value) {
    throw new Error("useSync must be used within a SyncProvider")
  }
  return value
}
