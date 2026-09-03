#!/usr/bin/env node
/*
 * Write the plain-text agent guides, site/skill.md and site/llms.txt, from
 * site/js/protocol.js, the same source docs.html renders. Run after editing
 * protocol.js:
 *
 *   node site/scripts/guides.mjs
 */
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const Protocol = createRequire(import.meta.url)(join(SITE_DIR, "js", "protocol.js"));
const { skill, llms } = Protocol.guides();

try {
  writeFileSync(join(SITE_DIR, "skill.md"), skill);
  writeFileSync(join(SITE_DIR, "llms.txt"), llms);
} catch (error) {
  console.error(`guides: cannot write: ${error.message}`);
  process.exit(1);
}
console.log(`site/skill.md ${skill.length} bytes, site/llms.txt ${llms.length} bytes`);
