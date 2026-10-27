# Contributing to Courier

Thank you for your interest in contributing to Courier — temporary email inboxes for AI agents! We welcome contributions from the community.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Pull Request Guidelines](#pull-request-guidelines)
- [Issue Reporting](#issue-reporting)
- [Project Structure](#project-structure)
- [Style Guides](#style-guides)
- [Testing](#testing)
- [Documentation](#documentation)
- [License](#license)

## Code of Conduct

This project is governed by the [MIT License](LICENSE). We expect all contributors to be respectful, constructive, and collaborative. Harassment or abusive behavior will not be tolerated.

## Getting Started

1. **Fork the repository** on GitHub.
2. **Clone your fork:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/courier.git
   cd courier
   ```
3. **Set up the development environment:**
   ```bash
   npm install
   ```
4. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/my-feature
   ```

## Development Workflow

1. Make your changes locally.
2. Validate JSON files:
   ```bash
   node -e "JSON.parse(require('fs').readFileSync('agent.json','utf8'))"
   node -e "JSON.parse(require('fs').readFileSync('openapi.json','utf8'))"
   node -e "JSON.parse(require('fs').readFileSync('capabilities.json','utf8'))"
   ```
3. Check Node.js syntax:
   ```bash
   node --check examples/integration-node.js
   ```
4. Commit with a descriptive message:
   ```bash
   git commit -m "feat: add support for X"
   ```
5. Push to your fork and open a pull request.

## Pull Request Guidelines

- **Keep PRs focused** — one feature or fix per PR.
- **Write clear descriptions** — explain what the change does and why.
- **Update documentation** if your change affects the API or usage.
- **Update `llms.txt`** if you add new capabilities an agent should know about.
- **Ensure all CI checks pass** — JSON validation, syntax checks, and markdown file existence.
- **Reference related issues** with "Closes #123" or "Relates to #456".
- **Use conventional commit prefixes:** `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`.

## Issue Reporting

### Bug Reports

When reporting a bug, please include:

- A clear, descriptive title.
- Steps to reproduce the issue.
- Expected behavior vs. actual behavior.
- Environment details (OS, Node.js version, npm version).
- Relevant logs, error messages, or screenshots.

### Feature Requests

Feature requests are welcome! Please include:

- A clear description of the proposed feature.
- The use case or problem it solves.
- Any relevant examples or mockups.

## Project Structure

```
courier/
├── agent.json              # Agent seed metadata
├── capabilities.json       # Service capabilities reference
├── CONTRIBUTING.md         # This file
├── docs/                   # Documentation
│   ├── agent-discovery-seed.md
│   └── smithery-submission.md
├── ecosystem/              # Ecosystem integration docs
├── examples/               # Usage examples
│   ├── problem-first/      # Real-world agent workflows
│   ├── node/               # Node.js examples
│   ├── python/             # Python examples
│   └── http/               # Shell/curl examples
├── lightning/              # Lightning/x402 specs
├── llms.txt                # LLM-optimized documentation
├── mcp-adapter/            # MCP adapter code
├── npm-aliases/            # npm package aliases
├── openapi.json            # OpenAPI specification
├── package.json            # Node.js package manifest
├── public/                 # Website files
├── pypi/                   # PyPI package source
├── specs/                  # Specification documents
├── courier-inbox-isolated.js
├── mail-receiver-v2.js
├── install.sh
├── patch-inbox.py
└── README.md
```

## Style Guides

### JavaScript / Node.js

- Use ES2020+ features where appropriate.
- Use `const` by default, `let` only when reassigning.
- Use 2-space indentation.
- Use semicolons.
- Follow the existing code style in the project.

### Markdown

- Use ATX-style headings (`##`, not underlines).
- Use fenced code blocks with language identifiers.
- Keep lines under 100 characters where practical.
- Use relative links for internal references.

### Shell Scripts

- Use `#!/usr/bin/env bash` shebang.
- Use `set -euo pipefail` for strict error handling.
- Add comments for non-obvious commands.

## Testing

Courier uses manual validation rather than automated test suites at present:

1. **JSON validation** — ensure all `.json` files are valid.
2. **Syntax checks** — run `node --check` on JavaScript files.
3. **End-to-end testing** — verify against the live service at https://getcourier.dev.

If your change affects email processing, test with a real SMTP message against the service.

## Documentation

Documentation is critical for AI agents consuming Courier. If your change adds or modifies:

- **API endpoints** — update `openapi.json` and `README.md`.
- **Agent capabilities** — update `capabilities.json` and `llms.txt`.
- **Installation instructions** — update `install.sh` and relevant `README.md` sections.
- **Framework integrations** — update the Framework Integration section in `README.md`.

## License

By contributing to Courier, you agree that your contributions will be licensed under the [MIT License](LICENSE).
