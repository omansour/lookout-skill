// lib/cli.js — shared output convention for all scripts.
// Success: JSON on stdout, exit 0.
// Expected/repairable error: exit 2, {"error":{code,message,hint}} on stderr.
// Unexpected error: exit 1, message on stderr.

export function ok(data) {
  process.stdout.write(JSON.stringify(data, null, 1) + '\n');
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
