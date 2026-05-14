import { Queue } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
});

export const repoQueue = new Queue("repo-processing", { connection });

export async function addRepoJob(
  owner: string,
  name: string,
  repositoryId: string,
) {
  const job = await repoQueue.add(
    "process-repo",
    { owner, name, repositoryId },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 5000 },
    },
  );
  return job.id;
}
