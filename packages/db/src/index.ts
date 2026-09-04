export * from "./schema/index.js";
export * from "./client.js";
export * from "./errors.js";
export { createAgent, type CreateAgentInput, type CreatedAgent } from "./create-agent.js";
// runMigrations lives on the ./migrate subpath: it points at the SQL folder
// with `new URL(..., import.meta.url)`, which bundlers try to resolve at build
// time, and the web app has no business bundling migrations. Everything that
// runs migrations — the CLI, the test helper — imports it from there already.
