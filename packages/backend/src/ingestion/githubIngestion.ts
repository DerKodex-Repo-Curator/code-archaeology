import { Octokit } from "@octokit/core";
import { RawPR } from "@archaeology/shared";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

export async function getPRForCommit(
  owner: string,
  repo: string,
  commitSha: string,
): Promise<RawPR | null> {
  try {
    const result = await octokit.graphql<any>(
      `
      query($owner: String!, $repo: String!, $sha: String!) {
        repository(owner: $owner, name: $repo) {
          object(expression: $sha) {
            ... on Commit {
              associatedPullRequests(first: 1) {
                nodes {
                  number
                  title
                  body
                  author { login }
                  closingIssuesReferences(first: 5) {
                    nodes {
                      number
                      title
                      body
                    }
                  }
                }
              }
            }
          }
        }
      }
    `,
      { owner, repo, sha: commitSha },
    );

    const prs = result.repository?.object?.associatedPullRequests?.nodes;
    if (!prs || prs.length === 0) return null;

    const pr = prs[0];
    return {
      number: pr.number,
      title: pr.title,
      body: pr.body || "",
      author: pr.author?.login || "unknown",
      issues: (pr.closingIssuesReferences?.nodes || []).map((i: any) => ({
        number: i.number,
        title: i.title,
        body: i.body || "",
      })),
    };
  } catch (err) {
    return null;
  }
}
