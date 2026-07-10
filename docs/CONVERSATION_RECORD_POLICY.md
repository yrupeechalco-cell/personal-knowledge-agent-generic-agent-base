# Project Conversation Record Policy

## Purpose

`CONVERSATION_RECORD.md` is the public decision record for this project. It preserves the product reasoning that led to the current application: user goals, major choices, implementation milestones, corrections, and unresolved work.

It exists so contributors and future maintainers can understand why the application behaves as it does without needing access to private chat history.

## What It Contains

- Product goals and constraints expressed during project conversations.
- Major decisions about architecture, interaction design, storage, Agent authority, and safety.
- A chronological summary of important implementation and debugging milestones.
- Current capabilities and deliberately unfinished boundaries.

## What It Does Not Contain

This repository is public. The record is a sanitized reconstruction, not a verbatim export. It never includes:

- API keys, tokens, passwords, account details, or secrets.
- Personal vault contents or note text.
- Private local paths, device identifiers, or other personally identifying filesystem details.
- Internal-only development memory or raw private logs.

Such values are represented only when useful to the decision history, using markers such as `[REDACTED]` or `[LOCAL_PATH_REDACTED]`.

## Maintenance Rule

When a conversation changes a durable product requirement or architectural decision, add a concise, privacy-safe entry to `CONVERSATION_RECORD.md`. Keep detailed private operational notes outside the public repository.
