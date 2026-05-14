import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import dotenv from "dotenv";
dotenv.config();

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
    console.log(`\n🚀 Processing: ${owner}/${name}`);

    // 1. clone repo
    await job.updateProgress(5);
    const repoPath = await cloneRepo(owner, name);

    // 2. get commits
    await job.updateProgress(10);
    const commits = await getCommits(repoPath, 200);
    console.log(`📦 Found ${commits.length} commits`);

    // 3. process each commit
    for (let i = 0; i < commits.length; i++) {
      const commit = commits[i];
      const progress = 10 + Math.floor((i / commits.length) * 80);
      await job.updateProgress(progress);

      try {
        console.log(
          `Processing commit ${i + 1}/${commits.length}: ${commit.hash.slice(0, 7)}`,
        );

        // get diff
        const diff = await getCommitDiff(repoPath, commit.hash);

        // try to get PR number from commit message first (no API call needed)
        let prNumber = extractPRNumber(commit.message);
        let prData = null;

        // if not found in message, ask GitHub API
        if (!prNumber) {
          prData = await getPRForCommit(owner, name, commit.hash);
          if (prData) prNumber = prData.number;
        }

        // save commit to postgres
        await prisma.commit.upsert({
          where: { hash: commit.hash },
          update: {},
          create: {
            hash: commit.hash,
            message: commit.message,
            author: commit.author,
            authorEmail: commit.authorEmail,
            date: commit.date,
            diff,
            prNumber: prNumber || null,
            repositoryId,
          },
        });

        // save PR + issues to postgres + neo4j
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

        // create commit node in neo4j
        await createCommitNode({
          hash: commit.hash,
          message: commit.message,
          author: commit.author,
          date: commit.date,
        });

        if (prNumber) {
          await linkCommitToPR(commit.hash, prNumber);
        }

        // AI summarization
        const summary = await summarizeDecision({
          commitMessage: commit.message,
          diff,
          prTitle: prData?.title,
          prBody: prData?.body,
          issueTitle: prData?.issues?.[0]?.title,
          issueBody: prData?.issues?.[0]?.body,
        });

        // update summary in postgres + neo4j
        await prisma.commit.update({
          where: { hash: commit.hash },
          data: { summary },
        });
        await updateCommitSummary(commit.hash, summary);

        // generate and store embedding
        const textToEmbed = `${commit.message} ${summary}`;
        const embedding = await generateEmbedding(textToEmbed);

        await prisma.commitEmbedding.upsert({
          where: { commitHash: commit.hash },
          update: { embedding },
          create: { commitHash: commit.hash, embedding },
        });

        // 300ms delay to respect GitHub rate limits
        await sleep(300);
      } catch (err) {
        console.error(`⚠️ Skipping commit ${commit.hash.slice(0, 7)}:`, err);
        // continue with next commit — don't fail entire job
      }
    }

    // 4. mark complete
    await job.updateProgress(100);
    await prisma.repository.update({
      where: { id: repositoryId },
      data: { status: "completed" },
    });

    console.log(
      `✅ Done: ${owner}/${name} — ${commits.length} commits processed`,
    );
    return { success: true, commitsProcessed: commits.length };
  },
  { connection },
);

worker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err.message);
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
