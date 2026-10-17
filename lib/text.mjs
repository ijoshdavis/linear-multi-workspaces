import { readFileSync } from "node:fs";
import { CliError } from "./output.mjs";

/** Reads markdown text from a file path, or from stdin when given "-". */
export function readTextArg(pathOrDash, { label = "text" } = {}) {
  if (pathOrDash === "-") {
    return readFileSync(0, "utf8");
  }
  try {
    return readFileSync(pathOrDash, "utf8");
  } catch (err) {
    throw new CliError("BAD_FILE", `Could not read ${label} file "${pathOrDash}": ${err.message}`);
  }
}

/** Parses the `--append-section "<heading>:<path|->"` flag value. */
export function parseAppendSection(value) {
  const idx = value.indexOf(":");
  if (idx === -1) {
    throw new CliError(
      "BAD_ARG",
      `--append-section expects "<heading>:<path|->", got "${value}".`
    );
  }
  const heading = value.slice(0, idx).trim();
  const source = value.slice(idx + 1).trim();
  const body = readTextArg(source, { label: "append-section" });
  return { heading, body };
}
