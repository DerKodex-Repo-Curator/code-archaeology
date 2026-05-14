import express from "express";
import dotenv from "dotenv";
dotenv.config();

import { prisma } from "./db/prisma";
import { addRepoJob } from "./queue/producer";
import "./queue/worker"; // boots the worker
import { getGraph } from "./graph/neo4j";
import { generateEmbedding, cosineSimilarity } from "./ai/embedder";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// ─── POST /api/repos ─────────────────────────────────────────
// start processing a repo
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

// ─── GET /api/repos/:id/status ────────────────────────────────
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

// ─── GET /api/repos/:id/graph ─────────────────────────────────
app.get("/api/repos/:id/graph", async (_req, res) => {
  try {
    const graph = await getGraph();
    res.json(graph);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /api/repos/:id/commits ───────────────────────────────
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

// ─── POST /api/repos/:id/ask ──────────────────────────────────
// RAG: ask anything about the codebase
app.post("/api/repos/:id/ask", async (req, res) => {
  const { question } = req.body;

  if (!question) return res.status(400).json({ error: "question is required" });

  try {
    // 1. embed the question
    const questionEmbedding = await generateEmbedding(question);

    // 2. get all embeddings from postgres
    const allEmbeddings = await prisma.commitEmbedding.findMany();

    if (allEmbeddings.length === 0) {
      return res.json({ answer: "No commits processed yet.", sources: [] });
    }

    // 3. rank by cosine similarity, take top 5
    const ranked = allEmbeddings
      .map((e) => ({
        commitHash: e.commitHash,
        score: cosineSimilarity(questionEmbedding, e.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    // 4. fetch commit details
    const commits = await prisma.commit.findMany({
      where: { hash: { in: ranked.map((r) => r.commitHash) } },
      include: {
        pullRequest: { include: { issues: true } },
      },
    });

    // 5. build context string
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

    // 6. ask ollama with context (RAG)
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

    const ollamaData = await ollamaRes.json();

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

// ─── GET /api/repos ───────────────────────────────────────────
app.get("/api/repos", async (_req, res) => {
  const repos = await prisma.repository.findMany({
    include: { _count: { select: { commits: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(repos);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(
    `\n🔍 Code Archaeology backend running on http://localhost:${PORT}`,
  );
  console.log(`📊 Neo4j browser: http://localhost:7474`);
});
