<p align="center">
  <picture>
    <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="SnowCode logo" width="300">
  </picture>
</p>

<h1 align="center">SnowCode</h1>
<h3 align="center">AI-Powered ServiceNow Development IDE</h3>
<p align="center"><strong>Part of the Snow-Flow Enterprise Suite</strong></p>

<p align="center">
  <a href="https://github.com/groeimetai/snowcode"><img alt="GitHub" src="https://img.shields.io/github/stars/groeimetai/snowcode?style=flat-square" /></a>
  <a href="https://github.com/groeimetai/snow-flow"><img alt="Snow-Flow MCP" src="https://img.shields.io/badge/snow--flow-350%2B%20tools-blue?style=flat-square" /></a>
  <a href="#enterprise-edition"><img alt="Enterprise" src="https://img.shields.io/badge/enterprise-available-green?style=flat-square" /></a>
</p>

---

## 🎯 What is SnowCode?

SnowCode is a specialized fork of [OpenCode](https://github.com/sst/opencode) (formerly Windsurf) optimized specifically for **ServiceNow development**. It combines an AI-powered coding assistant with deep ServiceNow integration through the [Snow-Flow MCP framework](https://github.com/groeimetai/snow-flow).

**Built for ServiceNow developers by ServiceNow experts.**

### Why SnowCode?

| Feature | SnowCode | Generic AI IDEs |
|---------|----------|-----------------|
| **ServiceNow MCP Tools** | ✅ 350+ built-in tools | ❌ None |
| **ES5 Validation** | ✅ Rhino engine checks | ❌ Modern JS only |
| **Update Set Workflow** | ✅ Automatic tracking | ❌ Manual process |
| **Widget Coherence** | ✅ HTML/Client/Server validation | ❌ No awareness |
| **Enterprise Integrations** | ✅ Jira/Azure/Confluence | ❌ Not available |
| **ServiceNow Best Practices** | ✅ Built-in CLAUDE.md rules | ❌ Generic guidance |

---

## 🚀 Quick Start

### Installation

```bash
# macOS/Linux - Quick install
curl -fsSL https://raw.githubusercontent.com/groeimetai/snowcode/main/install.sh | bash

# Or with package managers
npm i -g snowcode-ai@latest        # npm
brew install groeimetai/tap/snowcode   # Homebrew (coming soon)

# Windows
# Download from: https://github.com/groeimetai/snowcode/releases
```

### First Launch

```bash
# Start SnowCode
snowcode

# SnowCode will automatically:
# 1. Configure Snow-Flow MCP servers (350+ ServiceNow tools)
# 2. Load ServiceNow best practices (CLAUDE.md)
# 3. Set up ES5 validation for Rhino engine
```

---

## 🏗️ The Complete Snow-Flow Suite

SnowCode is part of a comprehensive ServiceNow development platform:

| Component | Purpose | Target Users | Tools Available |
|-----------|---------|--------------|-----------------|
| **[Snow-Flow](https://github.com/groeimetai/snow-flow)** | MCP Framework | Individual developers | **350+ ServiceNow tools** |
| **SnowCode** (This Project) | AI-Powered IDE | Development teams | All Snow-Flow + IDE features |
| **Enterprise Edition** | External Integrations | Service integrators | +40 enterprise tools |

### Open Source (Free)

**Snow-Flow** provides 350+ MCP tools covering:
- Core operations (query, CRUD, discovery)
- Widget & UI Builder development
- Update Set management
- Flow Designer integration
- Agent Workspace creation
- Platform development (business rules, client scripts, etc.)
- Automation & scripting
- ML & predictive intelligence

**SnowCode** adds:
- Terminal-based AI coding assistant
- Deep integration with Snow-Flow tools
- ServiceNow-optimized UI/UX
- ES5 syntax validation
- Update Set workflow automation
- Widget coherence checking

### Enterprise Edition

**Unlocks 40+ Additional MCP Tools** for external platform integration:

- **🔷 Azure DevOps** (10 tools) - Work item sync, pipeline automation, PR management
- **🟦 Jira** (8 tools) - Backlog management, issue tracking, JQL queries, sprint sync
- **📚 Confluence** (8 tools) - Documentation sync, page management, knowledge base
- **🤖 Advanced ML** (15+ tools) - Predictive Intelligence, forecasting, anomaly detection

**Additional Enterprise Features:**
- ✅ **Fully managed SaaS** - Hosted on Google Cloud (europe-west4)
- ✅ **License key activation** - Same codebase, enterprise servers unlocked
- ✅ **Agent task automation** - Agents can fetch tasks from Jira/Azure/Confluence
- ✅ **White-label portal** - Branded experience for service integrators
- ✅ **Enterprise security** - KMS encryption, SOC 2/ISO 27001 ready
- ✅ **24/7 priority support** - Dedicated support team

**Pricing:** Custom enterprise pricing. Contact **sales@snow-flow.dev**

---

## 🎓 For Service Integrators

### Why Service Integrators Choose SnowCode

**1. Accelerate ServiceNow Projects**
- Pre-configured with 350+ ServiceNow tools
- AI agent handles repetitive coding tasks
- Built-in best practices reduce review cycles
- Update Set workflow automation

**2. Consistent Delivery Quality**
- ES5 validation prevents Rhino engine errors
- Widget coherence checks ensure working UIs
- Automatic Update Set tracking for all changes
- ServiceNow-specific code generation

**3. Team Productivity**
- Onboard consultants faster (best practices built-in)
- Reduce context switching (terminal-based workflow)
- Knowledge retention through AI-powered guidance
- Multi-project support with isolated environments

**4. Client Billability**
- Faster development = more projects delivered
- Higher quality = fewer post-deployment issues
- Better documentation = easier knowledge transfer
- Enterprise integrations = unified backlog management

**5. Enterprise Features**
- White-label portal for your customers
- Jira/Azure/Confluence integration for unified workflows
- Client-specific licensing and customization
- Priority support and training for your team

### Typical Service Integrator Workflow

```bash
# 1. Consultant starts new ServiceNow project
snowcode

# 2. Agent automatically:
#    - Creates Update Set for new feature
#    - Pulls latest requirements from Jira/Azure
#    - Generates ServiceNow artifacts (widgets, business rules, etc.)
#    - Validates ES5 compliance
#    - Tracks all changes in Update Set
#    - Syncs status back to Jira/Azure

# 3. Deploy with confidence
#    - All changes tracked in Update Set
#    - No manual field updates or forgotten artifacts
#    - Ready for UAT/Production migration
```

### ROI for Service Integrators

**Without SnowCode:**
- Manual Update Set tracking
- ES5 syntax errors discovered in production
- Consultants forget ServiceNow best practices
- Jira/ServiceNow context switching overhead
- Average feature: 8 hours development + 2 hours fixes

**With SnowCode + Enterprise:**
- Automatic Update Set management
- ES5 validation catches errors during development
- Built-in best practices guidance
- Unified backlog management (Jira/Azure → ServiceNow)
- Average feature: 4 hours development + 0.5 hours fixes

**Result: 40-50% faster delivery per consultant**

---

## 🛠️ Key Features

### ServiceNow-Specific

- **350+ MCP Tools**: Direct access to every ServiceNow API and operation
- **ES5 Validation**: Real-time checks for Rhino engine compatibility
- **Update Set Automation**: Automatic change tracking in Update Sets
- **Widget Coherence**: Validates HTML/Client/Server script communication
- **Local Artifact Sync**: Edit large widgets/pages locally without token limits
- **Background Script Execution**: Test scripts with full output capture

### AI Development

- **Autonomous Agent**: AI handles multi-step ServiceNow development tasks
- **Context-Aware**: Understands ServiceNow architecture and best practices
- **Error Recovery**: Automatically fixes ES5 errors and validation issues
- **Code Generation**: Creates production-ready ServiceNow code

### Developer Experience

- **Terminal-Based**: Fast, keyboard-driven workflow
- **LSP Support**: Auto-completion for ServiceNow APIs
- **Multi-Provider**: Works with Anthropic, OpenAI, Google, or local models
- **Extensible**: Add custom MCP servers for your organization's tools

---

## 📚 Documentation

### Getting Started
- [Installation Guide](./docs/installation.md)
- [First Project Tutorial](./docs/tutorial.md)
- [Configuration Reference](./docs/configuration.md)

### ServiceNow Development
- [Snow-Flow MCP Documentation](https://github.com/groeimetai/snow-flow#readme)
- [ServiceNow Best Practices (CLAUDE.md)](https://github.com/groeimetai/snow-flow/blob/main/CLAUDE.md)
- [Widget Development Guide](./docs/widgets.md)
- [Update Set Workflow](./docs/update-sets.md)

### Enterprise
- [Enterprise Edition Overview](https://github.com/groeimetai/snow-flow#-enterprise-edition)
- [Service Integrator Onboarding](./docs/service-integrators.md)
- [White-Label Setup](./docs/white-label.md)
- [License Key Activation](./docs/license-activation.md)

---

## 🤝 Contributing

We welcome contributions! SnowCode is built on top of OpenCode and maintains compatibility with upstream.

**Before contributing:**
1. Read our [Contributing Guide](./CONTRIBUTING.md)
2. Check existing [Issues](https://github.com/groeimetai/snowcode/issues)
3. Join our [Discord Community](https://discord.gg/snowflow)

**Areas we're actively developing:**
- ServiceNow-specific UI improvements
- Additional MCP server integrations
- Performance optimizations for large instances
- Mobile client support

---

## 📦 Architecture

SnowCode uses a client/server architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                         SnowCode CLI                        │
│                    (Terminal Interface)                     │
└─────────────────────┬───────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    MCP Client Layer                         │
│            (Manages MCP Server Connections)                 │
└─────┬────────────────┬────────────────┬─────────────────────┘
      │                │                │
      ▼                ▼                ▼
┌───────────┐  ┌──────────────┐  ┌────────────────┐
│ Snow-Flow │  │ Enterprise   │  │  Custom MCP    │
│ MCP (350) │  │  MCP (+40)   │  │  Servers       │
└─────┬─────┘  └──────┬───────┘  └────────┬───────┘
      │                │                   │
      ▼                ▼                   ▼
┌───────────────────────────────────────────────────────────┐
│              ServiceNow Instance / APIs                   │
└───────────────────────────────────────────────────────────┘
```

This architecture allows:
- Remote execution (run on server, drive from mobile)
- Multiple clients (CLI, web, mobile apps)
- Extensible MCP servers (add your own tools)
- Separation of concerns (UI ≠ Logic)

---

## 🔒 Security & Privacy

- **Local-first**: Your code and data stay on your machine
- **No telemetry**: We don't collect usage data (unless you explicitly opt-in)
- **Open source**: Audit the entire codebase
- **Encrypted connections**: All ServiceNow API calls use HTTPS
- **Enterprise-ready**: SOC 2 / ISO 27001 compliance for Enterprise Edition

---

## 📄 License

SnowCode is licensed under the MIT License. See [LICENSE](./LICENSE) for details.

**Based on OpenCode** by [SST](https://github.com/sst/opencode) (MIT License).

---

## 🌟 Why We Forked OpenCode

OpenCode is an excellent AI coding assistant with a strong foundation. We chose to fork it to:

1. **ServiceNow Specialization**: Deep integration with ServiceNow APIs and workflows
2. **MCP-First Design**: Built around Model Context Protocol for extensibility
3. **Enterprise Features**: White-label capabilities for service integrators
4. **Terminal Focus**: Optimized for professional ServiceNow developers
5. **Community-Driven**: ServiceNow-specific improvements and best practices

We maintain compatibility with upstream OpenCode and contribute improvements back to the community when applicable.

---

## 📞 Support & Community

- **Documentation**: [Snow-Flow Docs](https://github.com/groeimetai/snow-flow)
- **Discord**: [Join our community](https://discord.gg/snowflow)
- **Issues**: [GitHub Issues](https://github.com/groeimetai/snowcode/issues)
- **Enterprise Sales**: sales@snow-flow.dev
- **Twitter/X**: [@snowflow_dev](https://twitter.com/snowflow_dev)

---

## 🚀 What's Next?

**Roadmap (2025):**
- [ ] Mobile client (iOS/Android) for remote development
- [ ] Web-based UI for browser access
- [ ] ServiceNow Studio integration
- [ ] Advanced debugging tools (breakpoints, watches)
- [ ] Team collaboration features
- [ ] Additional enterprise integrations (GitHub, GitLab, Bitbucket)

**Want to influence our roadmap?** Join our [Discord](https://discord.gg/snowflow) and share your feedback!

---

<p align="center">
  <strong>Built with ❤️ for the ServiceNow community</strong><br>
  <a href="https://github.com/groeimetai/snow-flow">Snow-Flow</a> •
  <a href="https://github.com/groeimetai/snowcode">SnowCode</a> •
  <a href="https://github.com/groeimetai/snow-flow#-enterprise-edition">Enterprise Edition</a>
</p>
