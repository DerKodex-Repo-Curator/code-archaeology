export interface Commit {
  hash: string;
  message: string;
  author: string;
  date: string;
  summary?: string;
}

export interface PullRequest {
  number: number;
  title: string;
  body?: string;
  author: string;
  issues: Issue[];
}

export interface Issue {
  number: number;
  title: string;
  body?: string;
}

export interface DecisionNode {
  id: string;
  type: "commit" | "pullrequest" | "issue";
  label: string;
  summary?: string;
  author?: string;
  date?: string;
}

export interface DecisionEdge {
  source: string;
  target: string;
  relation: "FIXES" | "PART_OF" | "REFERENCES";
}

export interface GraphData {
  nodes: DecisionNode[];
  edges: DecisionEdge[];
}

export interface RawCommit {
  hash: string;
  message: string;
  author: string;
  authorEmail: string;
  date: Date;
}

export interface RawIssue {
  number: number;
  title: string;
  body?: string;
}

export interface RawPR {
  number: number;
  title: string;
  body?: string;
  author: string;
  issues: RawIssue[];
}

export interface ProcessRepoResponse {
  repoId: string;
  jobId: string | number | null;
  message: string;
}

export interface AskSource {
  hash: string;
  message: string;
  summary?: string;
}

export interface AskResponse {
  answer?: string;
  sources: AskSource[];
}
