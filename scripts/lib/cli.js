// lib/cli.js — shared output convention for all scripts.
// Success: compact JSON on stdout (a model reads it — indentation is wasted
// tokens), exit 0.
// Expected/repairable error: exit 2, {"error":{code,message,hint}} on stderr.
// Unexpected error: exit 1, message on stderr.

export function ok(data) {
  process.stdout.write(JSON.stringify(data) + '\n');
  process.exit(0);
}

export function fail(code, message, hint) {
  process.stderr.write(JSON.stringify({ error: { code, message, hint } }) + '\n');
  process.exit(2);
}

export function unexpected(err) {
  process.stderr.write(`unexpected error: ${err?.stack ?? err}\n`);
  process.exit(1);
}
