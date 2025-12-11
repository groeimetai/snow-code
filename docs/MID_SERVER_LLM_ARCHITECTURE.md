# MID Server LLM Proxy Architecture

## Overview

This document describes the architecture for routing LLM requests through ServiceNow MID Servers to access on-premise/datacenter LLM models.

## Use Cases

1. **Air-gapped environments**: Organizations that cannot expose LLM services to the internet
2. **Data sovereignty**: Keep all AI interactions within the corporate network
3. **Cost optimization**: Use self-hosted models (Ollama, vLLM, LocalAI) without cloud costs
4. **Security compliance**: Ensure all LLM traffic passes through controlled infrastructure

## Architecture Options

### Option 1: ServiceNow LLM Gateway (Recommended)

```
┌──────────────┐     ┌─────────────────┐     ┌────────────────┐     ┌─────────────────┐
│  snow-code   │────►│   ServiceNow    │────►│   MID Server   │────►│   Local LLM     │
│  (developer) │     │   REST API      │     │   HTTP Probe   │     │   (Ollama/vLLM) │
└──────────────┘     └─────────────────┘     └────────────────┘     └─────────────────┘
     HTTPS              Scripted REST           ECC Queue              OpenAI API
```

**Components:**
1. **Scripted REST API** in ServiceNow (`/api/x_snow_llm/chat`)
2. **MID Server** with network access to local LLM
3. **ECC Queue** for async communication
4. **Snow-code provider** configured to use ServiceNow endpoint

**Pros:**
- Fully managed through ServiceNow
- Audit trail and logging
- Works with existing MID Server infrastructure
- No direct network access needed from developer machine

**Cons:**
- Higher latency (through ServiceNow)
- Requires ServiceNow scripting

### Option 2: MID Server REST Proxy

```
┌──────────────┐                          ┌────────────────┐     ┌─────────────────┐
│  snow-code   │─────────────────────────►│   MID Server   │────►│   Local LLM     │
│  (developer) │        HTTPS             │   REST Proxy   │     │   (Ollama/vLLM) │
└──────────────┘                          └────────────────┘     └─────────────────┘
                                              Port 8443              Port 11434
```

**Components:**
1. **MID Server extension** that exposes OpenAI-compatible REST endpoint
2. **TLS/mTLS** for secure communication
3. **Snow-code provider** configured with MID Server URL

**Pros:**
- Lower latency (direct to MID)
- Simpler architecture

**Cons:**
- Requires network access to MID Server
- Custom MID extension needed
- Security considerations (exposed endpoint)

### Option 3: VPN/Direct Access (Simplest)

```
┌──────────────┐                                              ┌─────────────────┐
│  snow-code   │─────────────────────────────────────────────►│   Local LLM     │
│  (developer) │              VPN / Internal Network          │   (Ollama/vLLM) │
└──────────────┘                                              └─────────────────┘
```

**Already supported** via custom provider config in snow-code.

## Recommended Implementation: Option 1

### Phase 1: ServiceNow LLM Gateway

#### 1.1 Scripted REST API (ServiceNow)

Create a Scripted REST API that:
- Receives OpenAI-compatible chat/completion requests
- Queues them via ECC Queue to MID Server
- MID Server forwards to local LLM
- Returns response through same channel

```javascript
// ServiceNow Scripted REST API: POST /api/x_snow_llm/v1/chat/completions
(function process(request, response) {
    var requestBody = request.body.data;
    var midServerName = gs.getProperty('x_snow_llm.mid_server');
    var llmEndpoint = gs.getProperty('x_snow_llm.llm_endpoint');

    // Queue request to MID Server
    var ecc = new GlideRecord('ecc_queue');
    ecc.initialize();
    ecc.agent = getMidServerId(midServerName);
    ecc.topic = 'RESTProbe';
    ecc.name = 'LLMRequest';
    ecc.source = 'snow-llm-gateway';
    ecc.queue = 'output';
    ecc.payload = JSON.stringify({
        url: llmEndpoint + '/v1/chat/completions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody
    });
    ecc.insert();

    // Wait for response (with timeout)
    var result = waitForECCResponse(ecc.sys_id, 60);
    response.setBody(result);
})(request, response);
```

#### 1.2 Snow-code Provider Configuration

Add to `~/.config/snow-code/config.json`:

```json
{
  "provider": {
    "servicenow-llm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "ServiceNow LLM Gateway",
      "options": {
        "baseURL": "{env:SERVICENOW_INSTANCE_URL}/api/x_snow_llm/v1",
        "apiKey": "{env:SERVICENOW_LLM_TOKEN}"
      },
      "models": {
        "llama3.3": {
          "name": "Llama 3.3 (via MID Server)"
        },
        "codellama": {
          "name": "Code Llama (via MID Server)"
        }
      }
    }
  }
}
```

#### 1.3 Auth Flow Integration

Add to `snow-code auth login`:

```
┌  Add credential
│
◆  Select provider
│  ● ServiceNow LLM Gateway
│  ...
└

◆  Configure MID Server LLM
│
│  ServiceNow Instance: dev12345.service-now.com
│  MID Server Name: my-mid-server
│  Local LLM URL: http://localhost:11434
│
│  [Test Connection]
│
└
```

### Phase 2: MID Server HTTP Probe Extension

Create a custom MID Server extension that:
1. Listens for LLM requests from ECC Queue
2. Forwards to local LLM endpoint
3. Returns response through ECC Queue

### Phase 3: Streaming Support

Implement Server-Sent Events (SSE) through:
1. ServiceNow Script Action for streaming
2. WebSocket fallback
3. Polling mechanism for real-time responses

## Configuration in snow-code auth

### New Auth Command Option

```bash
$ snow-code auth login

┌  Add credential
│
◆  Select provider
│  ○ Anthropic
│  ○ OpenAI
│  ● ServiceNow MID Server LLM (Enterprise)
│  ...
└
```

### Configuration Steps

1. **Select MID Server**
   ```
   ◆  Select MID Server
   │  ● my-datacenter-mid-1 (192.168.1.100)
   │  ○ my-datacenter-mid-2 (192.168.1.101)
   └
   ```

2. **Configure Local LLM**
   ```
   ◇  Local LLM URL (from MID Server perspective)
   │  http://llm-server.internal:11434
   │
   ◇  Local LLM Type
   │  ● Ollama
   │  ○ vLLM
   │  ○ LocalAI
   │  ○ Other (OpenAI-compatible)
   └
   ```

3. **Test Connection**
   ```
   ◆  Testing connectivity...
   │
   │  ✓ ServiceNow connection OK
   │  ✓ MID Server 'my-datacenter-mid-1' is UP
   │  ✓ LLM endpoint reachable from MID Server
   │  ✓ Model 'llama3.3' available
   │
   └  Connection successful!
   ```

4. **Deploy Gateway**
   ```
   ◆  Deploy ServiceNow LLM Gateway?
   │  This will create a Scripted REST API in your instance.
   │
   │  ● Yes, deploy now
   │  ○ No, I'll configure manually
   └
   ```

## Security Considerations

1. **Authentication**: Use ServiceNow OAuth for API access
2. **Authorization**: ACLs on Scripted REST API
3. **Encryption**: TLS for all communications
4. **Audit**: All requests logged in ServiceNow
5. **Rate Limiting**: Configurable via ServiceNow properties

## Implementation Timeline

1. **Week 1-2**: Scripted REST API + Basic ECC Queue integration
2. **Week 3**: snow-code auth flow integration
3. **Week 4**: Testing + Documentation
4. **Future**: Streaming support, MID extension

## Files to Create/Modify

### snow-code (IMPLEMENTED)
- `src/cli/cmd/auth.ts` - ✅ Added MID Server LLM option in provider selection
  - Added "ServiceNow MID Server LLM" option to LLM provider list
  - Added full configuration flow: ServiceNow check, MID Server name, LLM endpoint, LLM type, model name
  - Saves provider config to `~/.config/snow-code/config.json`
  - Excluded from model selection (uses custom models)

### Configuration Storage

The MID Server LLM configuration is stored in `~/.config/snow-code/config.json`:

```json
{
  "provider": {
    "servicenow-llm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "ServiceNow LLM Gateway",
      "options": {
        "baseURL": "https://dev12345.service-now.com/api/x_snow_llm/v1",
        "apiKey": "{env:SERVICENOW_LLM_TOKEN}"
      },
      "models": {
        "llama3.3": {
          "name": "llama3.3 (via MID Server)"
        }
      }
    }
  },
  "midServerLLM": {
    "midServer": "my-datacenter-mid-1",
    "llmEndpoint": "http://llm-server.internal:11434",
    "llmType": "ollama",
    "defaultModel": "llama3.3",
    "instanceUrl": "https://dev12345.service-now.com"
  },
  "model": "servicenow-llm/llama3.3"
}
```

### snow-flow (TODO)
- `src/mcp/servicenow-mcp-unified/tools/integration/snow_deploy_llm_gateway.ts` (new)
- `src/mcp/servicenow-mcp-unified/tools/integration/snow_test_llm_connectivity.ts` (new)

### ServiceNow (TODO)
- Scripted REST API: `x_snow_llm`
- System Properties for configuration
- MID Server probe handler
