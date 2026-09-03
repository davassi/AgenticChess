#!/usr/bin/env node
/*
 * Bundle one page of site/ into a single self-contained HTML fragment.
 *
 * The fragment has no doctype, html, head or body wrapper: it is what the
 * Claude artifact publisher expects, and browsers render it as-is. Local
 * stylesheets and deferred scripts are inlined, Google Fonts links are kept,
 * and links between pages can be rewritten to their published addresses.
 *
 * Usage:
 *   node site/scripts/bundle.mjs <page> <out> [page.html=https://... ...]
 *
 * Example:
 *   node site/scripts/bundle.mjs index.html dist/landing.html \
 *     register.html=https://example.com/register
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FONT_HOSTS = /fonts\.googleapis|fonts\.gstatic/;

function fail(message) {
  console.error(`bundle: ${message}`);
  process.exit(1);
}

function readSiteFile(relativePath) {
  const path = join(SITE_DIR, relativePath);
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    return fail(`cannot read ${path}: ${error.message}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseLinkMappings(args) {
  return args.map((arg) => {
    const index = arg.indexOf("=");
    if (index <= 0 || index === arg.length - 1) {
      return fail(`link mapping must look like page.html=https://..., got "${arg}"`);
    }
    return { from: arg.slice(0, index), to: arg.slice(index + 1) };
  });
}

function bundle(page, mappings) {
  const html = readSiteFile(page);
  const title = /<title>([\s\S]*?)<\/title>/.exec(html);
  const bodyMatch = /<body>([\s\S]*)<\/body>/.exec(html);
  if (!title || !bodyMatch) return fail(`${page} needs a <title> and a <body>`);

  const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)]
    .map((m) => `<style>\n${readSiteFile(m[1])}\n</style>\n`)
    .join("");
  const scripts = [...html.matchAll(/<script src="([^"]+)" defer><\/script>/g)]
    .map((m) => `<script>\n${readSiteFile(m[1])}\n</script>\n`)
    .join("");
  const fonts = [...html.matchAll(/<link[^>]+>/g)].map((m) => m[0]).filter((tag) => FONT_HOSTS.test(tag));

  let body = bodyMatch[1].replace(/<script src="[^"]+" defer><\/script>\s*/g, "");
  for (const { from, to } of mappings) {
    const pattern = new RegExp(`href="${escapeRegExp(from)}(#[^"]*)?"`, "g");
    body = body.replace(pattern, (_match, anchor) => `href="${to}${anchor || ""}"`);
  }

  return `<title>${title[1].trim()}</title>\n${fonts.join("\n")}\n${styles}${body.trim()}\n${scripts}`;
}

const [page, out, ...linkArgs] = process.argv.slice(2);
if (!page || !out) {
  fail("usage: node site/scripts/bundle.mjs <page> <out> [page.html=https://... ...]");
}
const fragment = bundle(page, parseLinkMappings(linkArgs));
try {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, fragment);
} catch (error) {
  fail(`cannot write ${out}: ${error.message}`);
}
console.log(`${out} ${fragment.length} bytes`);
