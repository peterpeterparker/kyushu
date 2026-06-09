import type { SpawnOptions } from "child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { nonNullish } from "./nullish.utils";

/**
 * This code is adapted from `nano-spawn`.
 * Source: https://github.com/sindresorhus/nano-spawn
 *
 * It includes logic to ensure proper command execution across platforms,
 * particularly handling shell requirements on Windows.
 *
 * If updating, consider checking for upstream changes in `nano-spawn`.
 */

// When setting `shell: true` under-the-hood, we must manually escape the file and arguments.
// This ensures arguments are properly split, and prevents command injection.
// eslint-disable-next-line local-rules/prefer-object-params
export const applyForceShell = async <Options extends SpawnOptions>(
  file: string,
  commandArguments: readonly string[],
  options: Options,
): Promise<[string, readonly string[], Options]> =>
  (await shouldForceShell(file, options))
    ? [
        escapeFile(file),
        commandArguments.map((argument) => escapeArgument(argument)),
        { ...options, shell: true },
      ]
    : [file, commandArguments, options];

// On Windows, running most executable files (except *.exe and *.com) requires using a shell.
// This includes *.cmd and *.bat, which itself includes Node modules binaries.
// We detect this situation and automatically:
//  - Set the `shell: true` option
//  - Escape shell-specific characters
// eslint-disable-next-line local-rules/prefer-object-params
const shouldForceShell = async <Options extends SpawnOptions>(
  file: string,
  { shell, cwd, env = process.env }: Options,
): Promise<boolean> => process.platform === "win32" && !shell && !(await isExe(file, cwd, env));

// Detect whether the executable file is a *.exe or *.com file.
// Windows allows omitting file extensions (present in the `PATHEXT` environment variable).
// Therefore we must use the `PATH` environment variable and make `stat` calls to check this.
// Environment variables are case-insensitive on Windows, so we check both `PATH` and `Path`.
// eslint-disable-next-line local-rules/prefer-object-params
const isExe = async (
  file: string,
  cwd: string | URL | undefined,
  { Path = "", PATH = Path }: NodeJS.ProcessEnv,
): Promise<boolean> =>
  // If the *.exe or *.com file extension was not omitted.
  // Windows common file systems are case-insensitive.
  exeExtensions.some((extension) => file.toLowerCase().endsWith(extension)) ||
  // Use returned assignment to keep code small
  (EXE_MEMO[`${file}\0${cwd}\0${PATH}`] ??= await mIsExe(file, cwd, PATH));

// Memoize the following function, for performance
const EXE_MEMO = {};

// eslint-disable-next-line local-rules/prefer-object-params
const mIsExe = async (
  file: string,
  cwd: string | URL | undefined,
  PATH: string,
): Promise<boolean> => {
  const parts = PATH
    // `PATH` is ;-separated on Windows
    .split(path.delimiter)
    // `PATH` allows leading/trailing ; on Windows
    .filter(Boolean)
    // `PATH` parts can be double quoted on Windows
    .map((part) => part.replace(/^"(.*)"$/, "$1"));

  // For performance, parallelize and stop iteration as soon as an *.exe of *.com file is found
  try {
    await Promise.all(
      exeExtensions
        .flatMap((extension) =>
          [cwd, ...parts]
            .filter(nonNullish)
            .map(
              (part) =>
                `${path.resolve(part instanceof URL ? part.toString() : part, file)}${extension}`,
            ),
        )
        .map(async (possibleFile) => {
          try {
            await stat(possibleFile);
          } catch {
            return;
          }

          throw 0;
        }),
    );
  } catch {
    return true;
  }

  return false;
};

// Other file extensions require using a shell
const exeExtensions = [".exe", ".com"];

// `cmd.exe` escaping for arguments.
// Taken from https://github.com/moxystudio/node-cross-spawn
const escapeArgument = (argument) =>
  escapeFile(
    escapeFile(`"${argument.replaceAll(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`),
  );

// `cmd.exe` escaping for file and arguments.
const escapeFile = (file: string): string => file.replaceAll(/([()\][%!^"`<>&|;, *?])/g, "^$1");
