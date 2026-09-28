# Orbit APM

Orbit is a focused, browser-based Associate Product Manager agent. Give it a product problem and operating context; it produces an execution-ready brief, PRD, RICE-prioritized backlog, experiment plan, risk register, launch checklist, decision log, and stakeholder update.

## What it does

- Turns a rough product problem into a structured plan in one workflow
- Highlights assumptions and unresolved decisions instead of hiding uncertainty
- Calculates consistent RICE-style priority scores
- Persists work on the current device with no account required
- Exports the full workspace as Markdown or JSON
- Imports prior JSON workspaces and keeps a local run history
- Exposes the primary workflow through WebMCP when the browser supports it
- Works responsively and supports keyboard-only use

Orbit is deterministic and runs entirely in the browser. It does not send product data to a third party, and it does not claim to replace product judgment, customer research, or legal/security review.

## Run locally

Node.js 20 or newer is required.

```bash
npm test
npm start
```

Then open `http://127.0.0.1:4173`.

## Test

```bash
npm run check
npm run test:coverage
```

The suite covers validation, signal extraction, prioritization, artifact generation, Markdown export, persistence-safe serialization, and WebMCP tool behavior.

## Architecture

- `dist/index.html` — accessible application shell
- `dist/styles.css` — responsive visual system
- `dist/agent.js` — deterministic APM planning engine
- `dist/app.js` — UI, persistence, imports, exports, and interactions
- `dist/webmcp.js` — browser-agent tool registration
- `tests/` — Node test suite with no third-party dependencies

## Security and privacy

All workspace content stays in browser storage unless the user explicitly downloads an export. User-provided text is rendered with DOM text nodes, not injected as HTML. Imported workspaces are validated and size-limited.

## License

MIT
