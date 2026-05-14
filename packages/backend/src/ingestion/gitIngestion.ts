import simpleGit from "simple-git";
import path from "path";
import fs from "fs";
import os from "os";
import { RawCommit } from "@archaeology/shared";

const REPOS_DIR = path.join(os.tmpdir(), "archaeology-repos");

export async function cloneRepo(owner: string, name: string): Promise<string> {
  const repoPath = path.join(REPOS_DIR, `${owner}-${name}`);

  if (!fs.existsSync(REPOS_DIR)) {
    fs.mkdirSync(REPOS_DIR, { recursive: true });
  }

  if (fs.existsSync(repoPath)) {
    console.log(`Repo exists, pulling latest...`);
    const git = simpleGit(repoPath);
    await git.pull();
    return repoPath;
  }

  console.log(`Cloning ${owner}/${name}...`);
  const git = simpleGit();
  await git.clone(`https://github.com/${owner}/${name}.git`, repoPath, [
    "--depth",
    "500", // only last 500 commits for speed
  ]);
  return repoPath;
}

export async function getCommits(
  repoPath: string,
  maxCount = 200,
): Promise<RawCommit[]> {
  const git = simpleGit(repoPath);
  const log = await git.log({ maxCount });

  return log.all.map((c) => ({
    hash: c.hash,
    message: c.message,
    author: c.author_name,
    authorEmail: c.author_email,
    date: new Date(c.date),
  }));
}

export async function getCommitDiff(
  repoPath: string,
  hash: string,
): Promise<string> {
  const git = simpleGit(repoPath);
  try {
    const diff = await git.show([
      hash,
      "--stat",
      "--patch",
      "--no-color",
      "-U3", // 3 lines of context
    ]);
    // cap at 3000 chars to not blow up ollama context
    return diff.slice(0, 3000);
  } catch {
    return "";
  }
}

export async function getBlameForFile(
  repoPath: string,
  filePath: string,
): Promise<{ hash: string; lineNumber: number; content: string }[]> {
  const git = simpleGit(repoPath);
  try {
    const raw = await git.raw(["blame", "--line-porcelain", filePath]);
    return parseBlame(raw);
  } catch {
    return [];
  }
}

function parseBlame(raw: string) {
  const lines: { hash: string; lineNumber: number; content: string }[] = [];
  const entries = raw.split("\n");
  let currentHash = "";
  let lineNumber = 0;

  for (const line of entries) {
    if (/^[0-9a-f]{40}/.test(line)) {
      const parts = line.split(" ");
      currentHash = parts[0];
      lineNumber = parseInt(parts[2]);
    } else if (line.startsWith("\t")) {
      lines.push({
        hash: currentHash,
        lineNumber,
        content: line.slice(1),
      });
    }
  }

  return lines;
}
