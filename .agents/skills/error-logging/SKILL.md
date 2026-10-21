---
name: error-logging
description: Use when adding error handling, logging, retries, input validation, or making an app resilient to failures in APIs, files, networks, or user input.
---

# Error Handling and Logging

## Errors

- Catch specific exceptions, never a bare `except` or `catch (e) {}`
- Handle errors where you can do something useful. Otherwise let them propagate to one central handler.
- Convert internal errors into clear, safe messages for users and keep the details in logs
- Fail fast on invalid input at the boundary with a message naming the field and the rule
- Define a small set of custom exception types for domain failures

## Retries

- Retry only transient failures: timeouts, 429, 5xx
- Use exponential backoff with jitter and a maximum attempt count
- Never retry non-idempotent operations without an idempotency key

## Logging

- Use the standard logging library with levels: debug, info, warning, error
- Log events with context: request id, user id, operation, duration
- Log at the point where the error is handled, not at every layer
- Never log passwords, tokens, API keys, or full personal data
- Use structured JSON logs in production

## User-facing behavior

- Show what happened and what to do next
- Preserve user input after a failure
- Provide a loading, empty, and error state for every async region
