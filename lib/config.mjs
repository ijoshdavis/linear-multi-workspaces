import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { CliError } from "./output.mjs";

const CREDENTIALS_PATH = join(homedir(), ".config", "linear-cli", "credentials.json");
const MARKER_PATH = join(process.cwd(), ".claude", "linear-workspace.json");

function warnIfGroupOrWorldReadable(path) {
  const mode = statSync(path).mode & 0o777;
  if (mode & 0o077) {
    process.stderr.write(
      `Warning: ${path} is readable by group/other (mode ${mode.toString(8)}). Run: chmod 600 ${path}\n`
    );
  }
}

function readJson(path, label) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new CliError(
      "BAD_CONFIG",
      `${label} at ${path} is not valid JSON: ${err.message}`
    );
  }
}

/**
 * Resolution order for the profile name: --profile flag > repo marker > error.
 * Resolution order for the team: --team flag > repo marker > undefined (commands that need it will error).
 */
export function resolveConfig({ profileFlag, teamFlag } = {}) {
  const marker = readJson(MARKER_PATH, "Workspace marker");

  const profile = profileFlag || marker?.profile;
  if (!profile) {
    throw new CliError(
      "NO_PROFILE",
      `No profile resolved. Pass --profile <name> or create ${MARKER_PATH} with {"profile": "<name>"}.`
    );
  }

  const credentials = readJson(CREDENTIALS_PATH, "Credential store");
  if (!credentials) {
    throw new CliError(
      "NO_CREDENTIALS",
      `No credential store found at ${CREDENTIALS_PATH}. Create it with {"<profile>": "lin_api_..."} and chmod 600.`
    );
  }
  warnIfGroupOrWorldReadable(CREDENTIALS_PATH);

  const apiKey = credentials[profile];
  if (!apiKey) {
    throw new CliError(
      "NO_CREDENTIAL_FOR_PROFILE",
      `Profile "${profile}" has no entry in ${CREDENTIALS_PATH}.`
    );
  }

  return {
    profile,
    apiKey,
    team: teamFlag || marker?.team,
    markerPath: MARKER_PATH,
  };
}
