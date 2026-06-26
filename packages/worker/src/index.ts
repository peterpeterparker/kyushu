import {
  ExportedHandlerSchema,
  WorkerRequestSchema,
  WorkerResponseSchema,
  type ExportedHandler,
  type WorkerRequest,
  type WorkerResponse,
} from "kyushu-types";
import { buildEnv } from "./env";

export const handleRequest = async ({
  app,
  request,
}: {
  app: ExportedHandler;
  request: WorkerRequest;
}): Promise<WorkerResponse> => {
  const env = buildEnv();

  const handler = ExportedHandlerSchema.parse(app);
  const req = WorkerRequestSchema.parse(request);

  const response = await handler.fetch(req, env);

  return WorkerResponseSchema.parse(response);
};
