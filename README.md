# 🧠 Code Archaeology

> **Git blame tells you WHO. Code Archaeology tells you WHY.**

A developer tool that traces the _why_ behind every line of code — correlating git history, pull requests, and issues into an interactive decision graph, powered by local AI.

![Graph View](https://img.shields.io/badge/status-MVP-brightgreen)
![Node](https://img.shields.io/badge/node-20%2B-green)
![pnpm](https://img.shields.io/badge/pnpm-monorepo-orange)

---

## 🔍 The Problem

You join a new codebase and see this:

```js
if (user.age > 13 && user.country !== "EU") {
  skipConsentScreen();
}
```

Why 13? Why EU? The senior who wrote it left. Slack has no record. You read 400 commits. Still no idea.

**This happens every single day in every company.**

---

## ✨ What It Does

Code Archaeology ingests a GitHub repository and builds a **visual decision graph** that answers _why_ code exists.

- 🔗 **Correlates** git blame → commits → PRs → issues automatically
- 🤖 **AI summaries** for every commit using local Ollama (fully offline)
- 🕸️ **Interactive graph** — click any node to see why it exists
- 💬 **Ask anything** — RAG-powered chat over your entire codebase history
- 🔒 **Fully local** — no data leaves your machine

---

## 🛠️ Tech Stack

| Layer            | Technology                         |
| ---------------- | ---------------------------------- |
| Frontend         | Next.js 15, React Flow, TypeScript |
| Backend          | Node.js, Express, TypeScript       |
| Queue            | BullMQ + Redis                     |
| Git Ingestion    | simple-git                         |
| GitHub Data      | Octokit + GraphQL API              |
| Graph DB         | Neo4j                              |
| Relational DB    | PostgreSQL + Prisma                |
| AI Summarization | Ollama (llama3.2)                  |
| Embeddings       | nomic-embed-text                   |
| Semantic Search  | RAG (cosine similarity)            |
| Monorepo         | pnpm workspaces                    |
| Infrastructure   | Docker Compose                     |

---

## 🏗️ Architecture

```
GitHub Repo URL
      ↓
  BullMQ Job Queue (Redis)
      ↓
  ┌─────────────────────────────┐
  │  Ingestion Pipeline         │
  │  ├── simple-git (blame/log) │
  │  └── Octokit GraphQL (PRs)  │
  └─────────────────────────────┘
      ↓
  PostgreSQL (raw data)
      ↓
  ┌─────────────────────────────┐
  │  AI Processing              │
  │  ├── llama3.2 (summaries)   │
  │  └── nomic-embed (vectors)  │
  └─────────────────────────────┘
      ↓
  Neo4j (decision graph)
      ↓
  Next.js Frontend
  ├── React Flow (graph viz)
  └── RAG Chat (ask anything)
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 20+
- pnpm
- Docker Desktop
- Ollama

### 1. Clone the repo

```bash
git clone https://github.com/Prabodh-dev/code-archaeology.git
cd code-archaeology
```

### 2. Pull Ollama models

```bash
ollama pull llama3.2
ollama pull nomic-embed-text
```

### 3. Start infrastructure

```bash
docker-compose up -d
```

### 4. Install dependencies

```bash
pnpm install
```

### 5. Setup environment

```bash
cp packages/backend/.env.example packages/backend/.env
```

Fill in your values:

```env
DATABASE_URL="postgresql://admin:admin@localhost:5433/archaeology"
REDIS_URL="redis://localhost:6380"
NEO4J_URI="bolt://localhost:7687"
NEO4J_USER="neo4j"
NEO4J_PASSWORD="password123"
GITHUB_TOKEN="your_github_pat_here"
OLLAMA_URL="http://localhost:11434"
PORT=3001
```

### 6. Run migrations

```bash
cd packages/backend
npx prisma migrate dev
```

### 7. Start the app

```bash
# Terminal 1 — backend
cd packages/backend && pnpm dev

# Terminal 2 — frontend
cd packages/frontend && pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) 🎉

---

## 📖 Usage

1. **Paste a GitHub repo** — enter owner and repo name
2. **Wait for processing** — commits are cloned, PRs fetched, AI summaries generated
3. **Explore the graph** — blue = commits, green = PRs, orange = issues
4. **Click any node** — see the AI-generated explanation of why it exists
5. **Ask questions** — switch to Ask tab and type anything

```
"Why was the qs dependency bumped?"
"What security issues were fixed?"
"Why was the auth flow changed?"
```

---

## 📁 Project Structure

```
code-archaeology/
├── packages/
│   ├── shared/          # Shared TypeScript types
│   ├── backend/         # Express API + ingestion pipeline
│   │   ├── src/
│   │   │   ├── ingestion/   # git + GitHub data fetching
│   │   │   ├── ai/          # Ollama summarizer + embedder
│   │   │   ├── graph/       # Neo4j graph operations
│   │   │   ├── queue/       # BullMQ worker + producer
│   │   │   └── index.ts     # Express server
│   │   └── prisma/      # Database schema
│   └── frontend/        # Next.js app
│       ├── app/         # Pages
│       └── components/  # GraphView, NodeDetail, AskChat
├── docker-compose.yml
└── pnpm-workspace.yaml
```

---

## 🗺️ Roadmap

- [ ] File-level blame view with Monaco editor
- [ ] Issue node visualization (orange nodes)
- [ ] Orphan detector — flag code with zero context
- [ ] Export graph as PNG/JSON
- [ ] GitHub App integration
- [ ] Support for GitLab and Bitbucket

---

## 🤝 Contributing

PRs welcome. This project is early — there's a lot to build.

1. Fork the repo
2. Create a branch: `git checkout -b feat/your-feature`
3. Commit: `git commit -m "feat: your feature"`
4. Push: `git push origin feat/your-feature`
5. Open a PR

---

<p align="center">
  Built with 🧠 by Prabodh
  <br/>
  <i>"The best code is code you understand. The second best is code with a trail."</i>
</p>
```
