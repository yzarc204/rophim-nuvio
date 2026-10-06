# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands
- **Development Server**: `npm run dev` (starts Wrangler dev server)
- **Type Checking**: `npm run typecheck`
- **Tests**: `npm run test` (runs Vitest once)
- **Watch Tests**: `npm run test:watch` (runs Vitest in watch mode)
- **Smoke Tests**: `npm run smoke` (runs E2E/smoke tests directly via Node)
- **Deploy**: `npm run deploy` (deploys via Wrangler)

## High-Level Architecture
This project is a **Stremio Addon** running on **Cloudflare Workers**. It provides an API that Stremio clients consume to search, view metadata, and stream video content (primarily integrating with Vietnamese movie providers).

- **Entry Point (`src/index.ts`)**: The main Cloudflare Worker fetch handler. It routes incoming Stremio addon HTTP requests (CORS, `/manifest.json`, `/catalog`, `/meta`, `/stream`) to specific handlers. It also serves static assets via an `ASSETS` binding.
- **Handlers (`src/handlers/`)**: Implements the Stremio Addon protocol logic.
  - `manifest.ts`: Defines what the addon supports.
  - `search.ts`: Resolves search queries from Stremio by querying underlying providers.
  - `meta.ts`: Returns metadata details for a specific item.
  - `stream.ts`: Extracts and returns stream URLs (resolving embeds when necessary) for a specific video ID.
- **Providers (`src/providers/`)**: The content source integrations. Each provider (like `ophim.ts`, `kkphim.ts`, `vsmov.ts`) conforms to a unified interface (`src/providers/types.ts`) to handle search, metadata fetching, and stream extraction for a specific website. They are managed through `registry.ts`.
- **Core Lib (`src/lib/`)**: Shared utilities.
  - `cache.ts`: Implements `TwoTierCache`, which acts as an isolate-wide memory singleton to speed up repeated queries.
  - `embed.ts`: Handles extraction of direct video links from various player embeds.
  - `id.ts`: Handles the generation and parsing of custom Stremio IDs.
  - `http.ts`: Network wrappers and helpers.

## Git
- Always commit every change
- Do not deploy the project, let me do it myself.