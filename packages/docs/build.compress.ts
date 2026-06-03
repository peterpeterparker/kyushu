import { createReadStream, createWriteStream } from "node:fs";
import { createBrotliCompress, createGzip } from "node:zlib";
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

const files = (source: string): string[] =>
  readdirSync(source).flatMap((file) => {
    const path = join(source, file);
    return lstatSync(path).isDirectory() ? files(path) : join(path);
  });

const brotliFile = async (params: { source: string; destination?: string }): Promise<string> =>
  await compressFile({
    ...params,
    algorithm: "brotli",
  });

const compressFile = async ({
  source,
  algorithm,
  destination,
}: {
  source: string;
  destination?: string;
  algorithm?: "gzip" | "brotli";
}): Promise<string> =>
  await new Promise<string>((resolve, reject) => {
    const sourceStream = createReadStream(source);

    const destinationPath = destination ?? `${source}.${algorithm === "brotli" ? "br" : "gz"}`;
    const destinationStream = createWriteStream(destinationPath);

    const compressor = algorithm === "brotli" ? createBrotliCompress() : createGzip();

    sourceStream.pipe(compressor).pipe(destinationStream);

    destinationStream.on("close", () => {
      resolve(destinationPath);
    });
    destinationStream.on("error", reject);
  });

const SKIP_EXTENSIONS = [".br", ".gz"];

const compressFiles = async () => {
  const allFiles = files(join(process.cwd(), "dist"));

  return await Promise.all(
    allFiles
      .filter((file) => !SKIP_EXTENSIONS.some((ext) => file.endsWith(ext)))
      .map(
        async (source) =>
          await brotliFile({
            source,
          }),
      ),
  );
};

const compressedFilePaths = await compressFiles();
console.log(`✅ ${compressedFilePaths.length} files compressed.`);
