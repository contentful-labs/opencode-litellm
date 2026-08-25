# Ship the integration as a typed npm plugin

- Status: Accepted
- Scope: OpenCode LiteLLM Plugin

## Context

OpenCode consumers need a small reusable integration whose public contract can be checked before publishing.

## Decision

Implement the plugin in TypeScript and make typechecking the package build gate.

## Consequences

Public API and model metadata changes must remain type-safe and the package build must pass before release.

