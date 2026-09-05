# @aichess/health

The `/health` endpoint the long-running services expose, so Docker can tell a
process that is alive from one that is working.

It lives in its own package because two services need exactly the same server
and neither should depend on the other: `apps/worker` talks to Postgres and
Redis, `apps/sparring` is a plain HTTP client of the arena, and a copy in each
would be a copy to keep in step.

The check is the caller's: this package only turns a boolean into 200 or 503,
answers 404 on any other route, and closes cleanly.
