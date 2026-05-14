// extract issue numbers from commit messages or PR bodies
// handles: "fixes #123", "closes #45", "resolves #67", "(#89)"
export function extractIssueNumbers(text: string): number[] {
  const patterns = [
    /(?:fixes|closes|resolves|fix|close|resolve)\s+#(\d+)/gi,
    /\(#(\d+)\)/g,
  ];

  const numbers = new Set<number>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      numbers.add(parseInt(match[1]));
    }
  }

  return Array.from(numbers);
}

// extract PR number from commit message
// handles: "Merge pull request #123 from..." and "Fix something (#123)"
export function extractPRNumber(commitMessage: string): number | null {
  const mergeMatch = commitMessage.match(/Merge pull request #(\d+)/i);
  if (mergeMatch) return parseInt(mergeMatch[1]);

  const squashMatch = commitMessage.match(/\(#(\d+)\)\s*$/);
  if (squashMatch) return parseInt(squashMatch[1]);

  return null;
}
