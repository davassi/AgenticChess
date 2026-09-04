import { AGENT_NAME_MAX } from "../protocol/enums.js";

/**
 * Turn a display name into a candidate slug. The result is either empty, when
 * nothing printable survives, or a string the `AGENT_SLUG_REGEX` accepts, so a
 * form can offer it without a second round of validation.
 */
export function slugify(name: string): string {
  const ascii = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const dashed = ascii.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return dashed.slice(0, AGENT_NAME_MAX).replace(/-+$/g, "");
}
