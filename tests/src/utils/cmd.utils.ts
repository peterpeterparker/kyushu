import {
  spawn as spawnCommand,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "child_process";
import { applyForceShell } from "./cmd.windows.utils";
import { nonNullish } from "./nullish.utils";

export const spawn = async ({
  command,
  cwd,
  args,
  env,
}: {
  command: string;
  cwd?: string;
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
}): Promise<ChildProcessWithoutNullStreams> => {
  const [escapedCommand, escapedArgs, options] = await applyForceShell(command, args ?? [], {
    stdio: "pipe",
    ...(nonNullish(cwd) && { cwd }),
    ...(nonNullish(env) && { env }),
  });

  const runner = spawnCommand(escapedCommand, escapedArgs, options);

  runner.stdout.on("data", (data) => console.log(`${data}`));
  runner.stderr.on("data", (data) => console.error(`${data}`));

  return runner;
};

export const execute = async ({
  command,
  args,
  env,
}: {
  command: string;
  args?: readonly string[];
  env?: NodeJS.ProcessEnv;
}): Promise<number | null> =>
  // eslint-disable-next-line no-async-promise-executor
  await new Promise<number | null>(async (resolve, reject) => {
    const [escapedCommand, escapedArgs, options] = await applyForceShell(command, args ?? [], {
      stdio: "inherit",
      ...(nonNullish(env) && { env }),
    });

    const childProcess: ChildProcess = spawnCommand(escapedCommand, escapedArgs ?? [], options);

    childProcess.on("close", (code) => {
      if (code === 0) {
        resolve(code);
        return;
      }

      reject(new Error(`Command failed with exit code ${code}`));
    });
  });
