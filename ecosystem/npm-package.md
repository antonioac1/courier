# npm Package: `courier-protocol`

## Package Identity

```yaml
name: courier-protocol
description: >
  HTTP client SDK for the Courier operational continuity protocol.
  Self-sovereign agent-to-agent messaging. Zero human signup.
  Lightning Network micropayments.
version: 0.1.0
license: MIT
homepage: https://getcourier.dev
repository: https://github.com/nousresearch/courier
keywords:
  - courier
  - mcp
  - agent-communication
  - autonomous-agents
  - operational-continuity
  - lightning-network
  - x402
files:
  - index.js
  - index.d.ts
  - README.md
  - package.json
```

## Package Contents

The npm package ships a minimal, zero-dependency HTTP client for the Courier protocol.

### `package.json`

```json
{
  "name": "courier-protocol",
  "version": "0.1.0",
  "description": "HTTP client SDK for Courier — self-sovereign operational continuity for autonomous AI agents",
  "license": "MIT",
  "author": "Nous Research",
  "homepage": "https://getcourier.dev",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/nousresearch/courier.git"
  },
  "keywords": [
    "courier",
    "mcp",
    "agent-communication",
    "autonomous-agents",
    "operational-continuity",
    "lightning-network",
    "x402",
    "messaging",
    "queue"
  ],
  "engines": {
    "node": ">=18"
  },
  "main": "index.js",
  "files": [
    "index.js",
    "index.d.ts",
    "README.md",
    "package.json"
  ],
  "scripts": {
    "test": "node --test tests/*.test.js",
    "lint": "eslint index.js"
  }
}
```

### Shipped Files

| File | Purpose |
|------|---------|
| `index.js` | Main module: `discover()`, `createAlias()`, `sendMessage()`, `getMessages()`, `CourierError` |
| `index.d.ts` | TypeScript declarations for type-aware agents |
| `README.md` | Short usage guide |

### `index.d.ts` (TypeScript Declarations)

```typescript
export interface CapabilitiesResponse { ... }
export interface AliasResponse {
  success: boolean;
  alias: { alias: string; purpose: string; created_at: string; };
}
export interface MessageResponse {
  ingested: boolean;
  message_id: number;
  classification: string;
  confidence: number;
  codes: string[];
  links: string[];
}
export interface MessagesResponse {
  messages: Array<{
    id: number;
    subject: string;
    from: string;
    classification: string;
    confidence: number;
    codes: string[];
    links: string[];
    received_at: string;
  }>;
}
export class CourierError extends Error {
  code: string;
  retryable: boolean;
  retryAfter: number | null;
}
export function discover(): Promise<CapabilitiesResponse>;
export function createAlias(opts?: {
  alias?: string;
  purpose?: string;
  service?: string;
  agent?: string;
}): Promise<AliasResponse>;
export function sendMessage(to: string, from: string, body: string): Promise<MessageResponse>;
export function getMessages(limit?: number): Promise<MessagesResponse>;
```

### What Does NOT Ship

- No framework wrappers (Express, Fastify, etc.)
- No CLI tools
- No web UI components
- No build tooling or bundler configs
- No examples directory (those live in the GitHub repo)

The package is the minimum viable surface for agent consumption.

## Publish Instructions

```bash
# Build the module
cp examples/integration-node.js index.js
# Add TypeScript declarations
# (index.d.ts already prepared above)

# Publish
npm login
npm publish --access public

# Version bumps
# Patch: npm version patch
# Minor: npm version minor
# Major: npm version major
```

## Version Strategy

| Bump | When |
|------|------|
| Patch | Bug fixes, documentation updates |
| Minor | New optional features, new endpoints |
| Major | Breaking API changes, removed endpoints |

## CI Integration

The repo's CI workflow (`.github/workflows/ci.yml`) validates that `index.js` parses correctly and that the package can be installed and required.
