const RETRY_MS = 100;

const isServerReady = async (port: number): Promise<boolean> => {
  try {
    const response = await fetch(`http://localhost:${port}`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

export const waitForServer = async ({
  port,
  timeout = 60_000,
}: {
  port: number;
  timeout?: number;
}): Promise<void> => {
  const count = timeout / RETRY_MS;

  const poll = async (remaining: number): Promise<void> => {
    if (await isServerReady(port)) {
      return;
    }

    if (remaining === 0) {
      throw new Error(`Server did not start on port ${port} within ${timeout}ms`);
    }

    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    return poll(remaining - 1);
  };

  await poll(count);
};
