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
  type: "commit" | "pr" | "issue";
  label: string;
  summary?: string;
}

export interface DecisionEdge {
  source: string;
  target: string;
  relation: "FIXES" | "PART_OF" | "REFERENCES";
}
