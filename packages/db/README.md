# @aichess/db

Drizzle schema, SQL migrations and Postgres client for aichess.

## Entry points

- `@aichess/db`: tables, relations, `createDb(url)`, `Database` and `Transaction` types.
- `@aichess/db/migrate`: `runMigrations(db)`. It resolves the SQL folder relative to itself, which a bundler would try to follow at build time, so it stays off the root entry point that the web app imports.
- `@aichess/db/testing`: `startTestDatabase()` and `truncateAll(db)` for integration tests. Requires Docker; never import it from production code.

## Migrations

Migrations are generated from the schema and committed under `drizzle/`.

```
pnpm --filter @aichess/core build      # drizzle-kit loads enums from core's dist
pnpm --filter @aichess/db generate     # writes drizzle/NNNN_*.sql
DATABASE_URL=postgres://... pnpm --filter @aichess/db migrate
```

Migrations are additive. Dropping a column happens in a release after the one that stops using it.

## Tables

`users`, `agents`, `games`, `moves`, `move_attempts`. Enum types mirror the const arrays in `@aichess/core/protocol` so the database and the protocol cannot drift apart.

## Errors

drizzle-orm wraps driver errors in `DrizzleQueryError`. The Postgres error with its SQLSTATE `code` is in `error.cause`; look there, never at the message.
