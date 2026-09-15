/**
 * Argument parsing for the authoring commands.
 *
 * These commands are written for scripts and coding agents as much as for
 * people, so everything is an explicit flag and nothing prompts.
 */

export type ParsedArgs = {
  positionals: string[];
  flags: Record<string, string | boolean>;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === undefined) continue;

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const body = token.slice(2);
    const equals = body.indexOf("=");

    if (equals !== -1) {
      flags[body.slice(0, equals)] = body.slice(equals + 1);
      continue;
    }

    const next = argv[index + 1];

    if (next === undefined || next.startsWith("--")) {
      flags[body] = true;
      continue;
    }

    flags[body] = next;
    index += 1;
  }

  return { positionals, flags };
}

export function flag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name];

  return typeof value === "string" ? value : undefined;
}

export function boolFlag(args: ParsedArgs, name: string): boolean {
  return args.flags[name] === true || args.flags[name] === "true";
}

export function requireFlag(args: ParsedArgs, name: string): string {
  const value = flag(args, name);

  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing --${name}.`);
  }

  return value;
}

export function requirePositional(args: ParsedArgs, index: number, label: string): string {
  const value = args.positionals[index];

  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing <${label}>.`);
  }

  return value;
}

/** Every authoring command targets exactly one environment. */
export function requireEnv(args: ParsedArgs): string {
  return requireFlag(args, "env");
}

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}
