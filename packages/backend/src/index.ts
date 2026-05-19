import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";

import { prisma } from "./db/prisma";
import { addRepoJob } from "./queue/producer";
import "./queue/worker"; // boots the worker
import {
  createCommitNode,
  createIssueNode,
  createPRNode,
  getGraph,
  linkCommitToPR,
  linkPRToIssue,
} from "./graph/neo4j";
import { generateEmbedding, cosineSimilarity } from "./ai/embedder";
import { extractPRNumber } from "./ingestion/correlator";
import { getPRForCommit } from "./ingestion/githubIngestion";

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  }),
);
app.use((req, _res, next) => {
  next();
});

app.post("/api/repos", async (req, res) => {
  const { owner, name } = req.body;

  if (!owner || !name) {
    return res.status(400).json({ error: "owner and name are required" });
  }

  try {
    const repo = await prisma.repository.upsert({
      where: { owner_name: { owner, name } },
      update: { status: "processing" },
      create: { owner, name, status: "processing" },
    });

    const jobId = await addRepoJob(owner, name, repo.id);

    res.json({ repoId: repo.id, jobId, message: "Processing started" });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/repos/:id/status", async (req, res) => {
  const repo = await prisma.repository.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { commits: true } } },
  });

  if (!repo) return res.status(404).json({ error: "Repo not found" });

  res.json({
    status: repo.status,
    owner: repo.owner,
    name: repo.name,
    commitsProcessed: repo._count.commits,
  });
});

app.get("/api/repos/:id/graph", async (_req, res) => {
  try {
    const graph = await getGraph();
    res.json(graph);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post("/api/repos/:id/sync-graph", async (req, res) => {
  const commits = await prisma.commit.findMany({
    where: { repositoryId: req.params.id },
  });

  for (const commit of commits) {
    await createCommitNode({
      hash: commit.hash,
      message: commit.message,
      author: commit.author,
      date: commit.date,
      summary: commit.summary || commit.message,
    });
  }

  res.json({ synced: commits.length });
});

app.post("/api/repos/:id/reprocess-prs", async (req, res) => {
  const commits = await prisma.commit.findMany({
    where: { repositoryId: req.params.id },
  });

  const repo = await prisma.repository.findUnique({
    where: { id: req.params.id },
  });

  if (!repo) return res.status(404).json({ error: "not found" });

  let linked = 0;

  for (const commit of commits) {
    const prNumber = extractPRNumber(commit.message);
    if (!prNumber) continue;

    try {
      const prData = await getPRForCommit(repo.owner, repo.name, commit.hash);
      if (!prData) continue;

      await prisma.pullRequest.upsert({
        where: { number: prData.number },
        update: {},
        create: {
          number: prData.number,
          title: prData.title,
          body: prData.body || "",
          author: prData.author,
          repositoryId: req.params.id,
        },
      });

      await prisma.commit.update({
        where: { hash: commit.hash },
        data: { prNumber: prData.number },
      });

      await createPRNode(prData);
      await linkCommitToPR(commit.hash, prData.number);

      for (const issue of prData.issues) {
        await prisma.issue.upsert({
          where: { number: issue.number },
          update: {},
          create: {
            number: issue.number,
            title: issue.title,
            body: issue.body || "",
            repositoryId: req.params.id,
          },
        });
        await createIssueNode(issue);
        await linkPRToIssue(prData.number, issue.number);
      }

      linked++;
      await sleep(500);
    } catch (err) {
      console.error(`Failed PR for ${commit.hash}:`, err);
    }
  }

  res.json({ linked });
});

app.get("/api/repos/:id/commits", async (req, res) => {
  const commits = await prisma.commit.findMany({
    where: { repositoryId: req.params.id },
    select: {
      hash: true,
      message: true,
      author: true,
      date: true,
      summary: true,
      prNumber: true,
    },
    orderBy: { date: "desc" },
    take: 200,
  });

  res.json(commits);
});

app.post("/api/repos/:id/ask", async (req, res) => {
  const { question } = req.body;

  if (!question) return res.status(400).json({ error: "question is required" });

  try {
    const questionEmbedding = await generateEmbedding(question);

    const allEmbeddings = await prisma.commitEmbedding.findMany();

    if (allEmbeddings.length === 0) {
      return res.json({ answer: "No commits processed yet.", sources: [] });
    }

    const ranked = allEmbeddings
      .map((e) => ({
        commitHash: e.commitHash,
        score: cosineSimilarity(questionEmbedding, e.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const commits = await prisma.commit.findMany({
      where: { hash: { in: ranked.map((r) => r.commitHash) } },
      include: {
        pullRequest: { include: { issues: true } },
      },
    });

    const context = commits
      .map((c) =>
        `
Commit: ${c.message}
Summary: ${c.summary || "N/A"}
PR: ${c.pullRequest?.title || "N/A"}
PR Description: ${c.pullRequest?.body?.slice(0, 300) || "N/A"}
Issues: ${c.pullRequest?.issues?.map((i) => i.title).join(", ") || "N/A"}
    `.trim(),
      )
      .join("\n\n---\n\n");

    const prompt = `You are a code archaeologist. Using the following real decisions made in a codebase, answer the question clearly and concisely.

Context:
${context}

Question: ${question}

Answer:`;

    const ollamaRes = await fetch(`${process.env.OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2",
        prompt,
        stream: false,
        options: { temperature: 0.3 },
      }),
    });

    const ollamaData = (await ollamaRes.json()) as { response?: string };

    res.json({
      answer: ollamaData.response?.trim(),
      sources: commits.map((c) => ({
        hash: c.hash.slice(0, 7),
        message: c.message,
        summary: c.summary,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/api/repos", async (_req, res) => {
  const repos = await prisma.repository.findMany({
    include: { _count: { select: { commits: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(repos);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
