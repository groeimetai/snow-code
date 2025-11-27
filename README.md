<p align="center">
<pre>
    ▲  ▲  ▲     █▀▀▀ █▀▀▄ █▀▀█ █   █   █▀▀▀ █▀▀█ █▀▀▄ █▀▀▀
   ▲ ▼▲ ▼▲      ▀▀▀█ █  █ █  █ █ █ █   █    █  █ █  █ █▀▀
  ▲ ▼  ▼  ▼     ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀▀   ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀
</pre>
</p>

<h1 align="center">Snow-Code</h1>
<h3 align="center">AI-Powered ServiceNow Development IDE</h3>
<p align="center"><strong>Part of the Snow-Flow Enterprise Suite</strong></p>

<p align="center">
  <a href="https://github.com/groeimetai/snow-code"><img alt="GitHub" src="https://img.shields.io/github/stars/groeimetai/snow-flow?style=flat-square" /></a>
  <a href="https://github.com/groeimetai/snow-flow"><img alt="Snow-Flow" src="https://img.shields.io/badge/snow--flow-350%2B%20tools-blue?style=flat-square" /></a>
  <a href="#enterprise-edition"><img alt="Enterprise" src="https://img.shields.io/badge/enterprise-available-green?style=flat-square" /></a>
</p>

# Snow-Code

**AI-Powered ServiceNow Development IDE**

[![GitHub stars](https://img.shields.io/github/stars/groeimetai/snow-code?style=for-the-badge&logo=github)](https://github.com/groeimetai/snow-code)
[![npm](https://img.shields.io/npm/v/@groeimetai/snow-code?style=for-the-badge&logo=npm&color=CB3837)](https://www.npmjs.com/package/@groeimetai/snow-code)

**Built by developers, for developers.** Snow-Code is the terminal-based AI IDE for ServiceNow development. Part of the [Snow-Flow](https://github.com/groeimetai/snow-flow) platform - the free, open-source alternative to ServiceNow Build Agent.

---

## Get Started in 60 Seconds

```bash
# Install Snow-Flow (includes Snow-Code)
npm install -g snow-flow

# Initialize your project
snow-flow init

# Authenticate with ServiceNow (+ optional Jira/Azure/Confluence)
snow-flow auth login

# Start developing
snow-flow agent "create an incident dashboard widget"
```

That's it. You're now developing ServiceNow through conversation.

---

## Why Snow-Code?

### vs ServiceNow Build Agent

| | Snow-Code + Snow-Flow | ServiceNow Build Agent |
|---|---|---|
| **Price** | **Free** (open source) | $100-200/user/month + Pro Plus |
| **AI Model** | **Any** - Claude, GPT-4, Gemini, Ollama | NowLLM only |
| **Development** | **Local terminal/IDE** | Browser-based Studio |
| **Enterprise Tools** | **Jira, Azure DevOps, Confluence** | ServiceNow only |
| **Open Source** | **Yes** | No |

### vs Generic AI IDEs

| Feature | Snow-Code | Cursor/Windsurf/etc |
|---------|----------|---------------------|
| **ServiceNow MCP Tools** | 410+ built-in | None |
| **ES5 Validation** | Rhino engine checks | Modern JS only |
| **Update Set Workflow** | Automatic tracking | Manual |
| **Widget Coherence** | HTML/Client/Server validation | No awareness |
| **Enterprise Integrations** | Jira/Azure/Confluence | Not ServiceNow-specific |

---

## What You Get

- **410+ MCP Tools** - Complete ServiceNow API coverage
- **Any LLM Provider** - Claude, GPT-4, Gemini, Mistral, DeepSeek, or free Ollama
- **ES5 Validation** - Catches Rhino engine errors before deployment
- **Update Set Management** - Automatic change tracking
- **Widget Coherence Checking** - Validates HTML ↔ Client ↔ Server communication
- **Local Development** - Pull artifacts to local files, edit with native tools
- **Enterprise Integrations** - Jira, Azure DevOps, Confluence

---

## How It Works

Snow-Code uses the Model Context Protocol (MCP) to give AI direct access to ServiceNow:

```bash
# Create widgets
snow-flow agent "create incident dashboard with priority charts"

# Build automation
snow-flow agent "create business rule to auto-assign incidents by category"

# Query data
snow-flow agent "show me all P1 incidents from last week"

# Enterprise workflows (requires enterprise license)
snow-flow agent "sync this story from Jira and implement it"
```

The AI:
1. Creates an Update Set to track changes
2. Builds the artifacts (widgets, business rules, etc.)
3. Deploys to your ServiceNow instance
4. Validates ES5 compliance and coherence

---

## Configuration

### ServiceNow OAuth Setup

1. In ServiceNow: **System OAuth → Application Registry → New**
2. Create OAuth endpoint:
   - **Redirect URL**: `http://localhost:3005/callback`
   - **Refresh Token Lifespan**: `0` (unlimited)
3. Add to `.env`:

```bash
SNOW_INSTANCE=your-instance.service-now.com
SNOW_CLIENT_ID=your-client-id
SNOW_CLIENT_SECRET=your-client-secret
```

### LLM Provider

```bash
# Claude (recommended)
DEFAULT_LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Claude Pro/Max subscription (no API key)
DEFAULT_LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=
# Run: snow-flow auth login

# GPT-4
DEFAULT_LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...

# 100% Free - Ollama
DEFAULT_LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
DEFAULT_OLLAMA_MODEL=llama3.3
```

---

## Enterprise Features

For teams needing external integrations:

### Jira Integration
- Bidirectional story/epic sync
- JQL queries from AI
- Automatic status updates
- Full autonomous workflow

### Azure DevOps Integration
- Work item sync
- Pipeline status
- Pull request tracking

### Confluence Integration
- Documentation sync
- Knowledge article generation

**Pricing:** Starting at $99/month - [portal.snow-flow.dev](https://portal.snow-flow.dev)

---

## Commands

```bash
# Main workflow
snow-flow init              # Initialize project
snow-flow auth login        # Authenticate everything
snow-flow agent "task"      # Execute any ServiceNow task

# Or launch the IDE directly
snow-code                   # Start Snow-Code IDE
```

---

## Architecture

Snow-Code is part of the Snow-Flow platform:

```
┌─────────────────────────────────────────────┐
│              Snow-Code (IDE)                │
│         Terminal-based AI assistant         │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│            Snow-Flow (MCP Layer)            │
│              410+ ServiceNow tools          │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│     ServiceNow Instance + Enterprise APIs   │
│     (Jira, Azure DevOps, Confluence)        │
└─────────────────────────────────────────────┘
```

---

## Requirements

- **Node.js** 18+
- **ServiceNow** instance with OAuth
- **LLM Provider** - API key or Ollama

---

## Links

- **Snow-Flow** (MCP framework): [github.com/groeimetai/snow-flow](https://github.com/groeimetai/snow-flow)
- **npm**: [npmjs.com/package/snow-flow](https://www.npmjs.com/package/snow-flow)
- **Enterprise Portal**: [portal.snow-flow.dev](https://portal.snow-flow.dev)
- **Issues**: [GitHub Issues](https://github.com/groeimetai/snow-code/issues)

---

## License

MIT License - Based on [OpenCode](https://github.com/sst/opencode).

---

**Snow-Code** - The AI-powered ServiceNow IDE. Built by developers, for developers.

```bash
npm install -g snow-flow && snow-flow init && snow-flow auth login && snow-flow agent "hello servicenow"
```
