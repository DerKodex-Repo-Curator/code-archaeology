import neo4j from "neo4j-driver";
import { GraphData } from "@archaeology/shared";

const driver = neo4j.driver(
  process.env.NEO4J_URI!,
  neo4j.auth.basic(process.env.NEO4J_USER!, process.env.NEO4J_PASSWORD!),
);

export async function createCommitNode(data: {
  hash: string;
  message: string;
  author: string;
  date: Date;
  summary?: string;
}) {
  const session = driver.session();
  try {
    await session.run(
      `
      MERGE (c:Commit {hash: $hash})
      SET c.message = $message,
          c.author = $author,
          c.date = $date,
          c.summary = $summary
    `,
      { ...data, date: data.date.toISOString(), summary: data.summary || "" },
    );
  } finally {
    await session.close();
  }
}

export async function createPRNode(data: {
  number: number;
  title: string;
  body?: string;
  author: string;
}) {
  const session = driver.session();
  try {
    await session.run(
      `
      MERGE (p:PullRequest {number: $number})
      SET p.title = $title,
          p.body = $body,
          p.author = $author
    `,
      { ...data, body: data.body || "" },
    );
  } finally {
    await session.close();
  }
}

export async function createIssueNode(data: {
  number: number;
  title: string;
  body?: string;
}) {
  const session = driver.session();
  try {
    await session.run(
      `
      MERGE (i:Issue {number: $number})
      SET i.title = $title,
          i.body = $body
    `,
      { ...data, body: data.body || "" },
    );
  } finally {
    await session.close();
  }
}

export async function linkCommitToPR(commitHash: string, prNumber: number) {
  const session = driver.session();
  try {
    await session.run(
      `
      MATCH (c:Commit {hash: $commitHash})
      MATCH (p:PullRequest {number: $prNumber})
      MERGE (c)-[:PART_OF]->(p)
    `,
      { commitHash, prNumber },
    );
  } finally {
    await session.close();
  }
}

export async function linkPRToIssue(prNumber: number, issueNumber: number) {
  const session = driver.session();
  try {
    await session.run(
      `
      MATCH (p:PullRequest {number: $prNumber})
      MATCH (i:Issue {number: $issueNumber})
      MERGE (p)-[:FIXES]->(i)
    `,
      { prNumber, issueNumber },
    );
  } finally {
    await session.close();
  }
}

export async function updateCommitSummary(hash: string, summary: string) {
  const session = driver.session();
  try {
    await session.run(
      `
      MATCH (c:Commit {hash: $hash})
      SET c.summary = $summary
    `,
      { hash, summary },
    );
  } finally {
    await session.close();
  }
}

export async function getGraph(): Promise<GraphData> {
  const session = driver.session();
  try {
    const result = await session.run(`
      MATCH (n)-[r]->(m)
      RETURN n, r, m
      LIMIT 300
    `);

    const nodesMap = new Map<string, any>();
    const edges: GraphData["edges"] = [];

    result.records.forEach((record) => {
      const source = record.get("n");
      const target = record.get("m");
      const rel = record.get("r");

      const sourceId = source.identity.toString();
      const targetId = target.identity.toString();

      if (!nodesMap.has(sourceId)) {
        nodesMap.set(sourceId, {
          id: sourceId,
          type: source.labels[0].toLowerCase(),
          label:
            source.properties.message ||
            source.properties.title ||
            `#${source.properties.number}`,
          summary: source.properties.summary || undefined,
          author: source.properties.author || undefined,
          date: source.properties.date || undefined,
        });
      }

      if (!nodesMap.has(targetId)) {
        nodesMap.set(targetId, {
          id: targetId,
          type: target.labels[0].toLowerCase(),
          label:
            target.properties.message ||
            target.properties.title ||
            `#${target.properties.number}`,
          summary: target.properties.summary || undefined,
          author: target.properties.author || undefined,
          date: target.properties.date || undefined,
        });
      }

      edges.push({
        source: sourceId,
        target: targetId,
        relation: rel.type as any,
      });
    });

    return {
      nodes: Array.from(nodesMap.values()),
      edges,
    };
  } finally {
    await session.close();
  }
}

export { driver };
