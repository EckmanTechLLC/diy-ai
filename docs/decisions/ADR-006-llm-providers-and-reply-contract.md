# ADR-006: Swappable LLM providers, reply contract, and key storage

- **Status**: Accepted (2026-11-14)

## Context
The user runs local models on an "Odin box" (llama.cpp servers with an OpenAI-style API: `qwen3.6-coder`, `gpt-oss-120b`) and wants to know whether they can do the chat-to-circuit job instead of, or alongside, Claude. Accuracy is the top priority, so the choice must be made on measured results. The user also wants to enter the Claude API key and switch models from the UI.

## Decision
- **One provider interface, two backends** in `apps/api`: Claude via the official `@anthropic-ai/sdk`; local models via plain `fetch` to an OpenAI-style `/v1/chat/completions` endpoint with JSON-schema-constrained output. No OpenAI package.
- **Reply contract** (defined in `packages/core`, shared by both backends and the test set). The model returns exactly one of:
  - a clarifying question;
  - a wiring template choice with parameters;
  - a custom circuit, used only when no template fits — stored and shown as **unverified topology** (ADR-002 fallback);
  - "not supported".
  Our code builds the circuit from the template, or validates the custom circuit, and feeds validation issues back to the model for a bounded number of retries. The model never supplies coordinates.
- **Wiring templates** live in `packages/core` as parameterised builders; the first four are the verified spike circuits.
- **Prompt and schema are provider-neutral**: the reply JSON schema must satisfy both Claude structured outputs and llama.cpp grammar constraints (flat, no recursion, no numeric/length bounds — those are checked in our code).
- **Settings in the database, per owner**: configured providers (Claude; any number of local endpoints by base URL, with the served model discovered from the endpoint), and the active model for chat.
- **Claude API key**: stored unencrypted in the local SQLite database, write-only — the API never returns it, only whether one is set and its last four characters. An `ANTHROPIC_API_KEY` environment variable takes precedence. Default Claude model: `claude-opus-5-5`, changeable in the UI.
- **Model choice is decided by a test set**: job descriptions with known-correct outcomes, run against each model, kept as a regression suite.

## Consequences
- Before any public release the key must become per-user and encrypted at rest, and local-endpoint URLs must be restricted (a user-supplied URL fetched by the server is a server-side request forgery risk).
- Chat messages and the circuit's origin (template id and parameters, or custom/unverified) are stored with the project.
- Local endpoints are trusted network services chosen by the owner; requests to them carry the conversation text.
- Claude-only features (web search with citations, refusal fallbacks) cannot be assumed by shared code paths.
