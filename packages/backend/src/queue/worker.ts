import dotenv from "dotenv";
dotenv.config();

import { Worker, Job } from "bullmq";
import IORedis from "ioredis";

import {
  cloneRepo,
  getCommits,
  getCommitDiff,
} from "../ingestion/gitIngestion";
import { getPRForCommit } from "../ingestion/githubIngestion";
import { extractPRNumber } from "../ingestion/correlator";
import { summarizeDecision } from "../ai/summarizer";
import { generateEmbedding } from "../ai/embedder";
import {
  createCommitNode,
  createPRNode,
  createIssueNode,
  linkCommitToPR,
  linkPRToIssue,
  updateCommitSummary,
} from "../graph/neo4j";
import { prisma } from "../db/prisma";

const connection = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
});

export const worker = new Worker(
  "repo-processing",
  async (job: Job) => {
    const { owner, name, repositoryId } = job.data;

    console.log(`Processing: ${owner}/${name}`);

    await job.updateProgress(5);
    const repoPath = await cloneRepo(owner, name);

    await job.updateProgress(10);
    const commits = await getCommits(repoPath, 20);

    for (let i = 0; i < commits.length; i++) {
      const commit = commits[i];
      const progress = 10 + Math.floor((i / commits.length) * 80);
      await job.updateProgress(progress);

      try {
        const diff = await getCommitDiff(repoPath, commit.hash);

        let prNumber = extractPRNumber(commit.message);
        let prData = null;
        let resolvedPrNumber: number | null = null;

        if (!prNumber) {
          prData = await getPRForCommit(owner, name, commit.hash);
          if (prData) prNumber = prData.number;
        }

        if (prData) {
          await prisma.pullRequest.upsert({
            where: { number: prData.number },
            update: {},
            create: {
              number: prData.number,
              title: prData.title,
              body: prData.body || "",
              author: prData.author,
              repositoryId,
            },
          });

          await createPRNode(prData);
          resolvedPrNumber = prData.number;
        }

        if (!resolvedPrNumber && prNumber) {
          const existingPR = await prisma.pullRequest.findUnique({
            where: { number: prNumber },
          });

          if (existingPR) {
            resolvedPrNumber = prNumber;
          }
        }

        await prisma.commit.upsert({
          where: { hash: commit.hash },
          update: resolvedPrNumber ? { prNumber: resolvedPrNumber } : {},
          create: {
            hash: commit.hash,
            message: commit.message,
            author: commit.author,
            authorEmail: commit.authorEmail,
            date: commit.date,
            diff,
            prNumber: resolvedPrNumber,
            repositoryId,
          },
        });

        if (prData) {
          for (const issue of prData.issues) {
            await prisma.issue.upsert({
              where: { number: issue.number },
              update: {},
              create: {
                number: issue.number,
                title: issue.title,
                body: issue.body || "",
                repositoryId,
              },
            });

            await createIssueNode(issue);
            await linkPRToIssue(prData.number, issue.number);
          }
        }

        await createCommitNode({
          hash: commit.hash,
          message: commit.message,
          author: commit.author,
          date: commit.date,
        });

        if (resolvedPrNumber) {
          await linkCommitToPR(commit.hash, resolvedPrNumber);
        }

        const summary = await summarizeDecision({
          commitMessage: commit.message,
          diff,
          prTitle: prData?.title,
          prBody: prData?.body,
          issueTitle: prData?.issues?.[0]?.title,
          issueBody: prData?.issues?.[0]?.body,
        });

        await prisma.commit.update({
          where: { hash: commit.hash },
          data: { summary },
        });
        await updateCommitSummary(commit.hash, summary);

        const textToEmbed = `${commit.message} ${summary}`;
        const embedding = await generateEmbedding(textToEmbed);

        await prisma.commitEmbedding.upsert({
          where: { commitHash: commit.hash },
          update: { embedding },
          create: { commitHash: commit.hash, embedding },
        });

        await sleep(300);
      } catch (err) {}
    }

    await job.updateProgress(100);
    await prisma.repository.update({
      where: { id: repositoryId },
      data: { status: "completed" },
    });

    return { success: true, commitsProcessed: commits.length };
  },
  { connection },
);

worker.on("completed", (job) => {});

worker.on("failed", (job, err) => {});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
