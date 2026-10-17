// Every command prints exactly one JSON line to stdout and exits 0 (ok) or 1 (error).
// Stderr is free for human-readable progress; stdout must stay pure JSON for callers to parse.

export function ok(data) {
  process.stdout.write(JSON.stringify({ ok: true, data }) + "\n");
  process.exit(0);
}

export function fail(code, message, extra) {
  process.stdout.write(
    JSON.stringify({ ok: false, error: { code, message, ...extra } }) + "\n"
  );
  process.exit(1);
}

export class CliError extends Error {
  constructor(code, message, extra) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

export async function run(fn) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof CliError) {
      fail(err.code, err.message, err.extra);
    } else {
      fail("UNEXPECTED", err?.message ?? String(err), {
        stack: err?.stack,
      });
    }
  }
}
