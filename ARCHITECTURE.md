# Architecture

## Purpose

Public TypeScript plugin that connects OpenCode to LiteLLM and maintains model/pricing support.

## Main areas

- src/plugin contains plugin behavior.
- src/types contains TypeScript contracts.
- src/utils contains shared helpers.
- assets contains repository documentation assets; package.json controls publishing.

## Change flow

Repository manifests and checked-in configuration define how source becomes a build, package, report, example, or documentation artifact. Keep changes inside the owning area and follow explicit dependencies rather than copying behavior between components.

## Boundaries

External services, credentials, and deployment environments are not represented by source code alone. Local validation should use documented fixtures or configuration and must not embed secrets.

## Failure and verification

Start with the narrowest affected command, inspect its direct inputs, and expand to repository-level validation. If a required external system is unavailable, record that verification gap instead of claiming success.

