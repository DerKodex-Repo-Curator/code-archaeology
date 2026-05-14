export async function summarizeDecision(data: {
  commitMessage: string;
  diff: string;
  prTitle?: string;
  prBody?: string;
  issueTitle?: string;
  issueBody?: string;
}): Promise<string> {
  const prompt = `You are a code archaeologist. Given the following information about a code change, write a 2-3 sentence explanation of WHY this change was made. Focus only on the reason/motivation, not what technically changed.

Commit: ${data.commitMessage}
${data.prTitle ? `PR: ${data.prTitle}` : ""}
${data.prBody ? `PR Description: ${data.prBody.slice(0, 400)}` : ""}
${data.issueTitle ? `Related Issue: ${data.issueTitle}` : ""}
${data.issueBody ? `Issue Details: ${data.issueBody.slice(0, 400)}` : ""}
${data.diff ? `Diff (truncated): ${data.diff.slice(0, 800)}` : ""}

Respond with only the 2-3 sentence explanation. No preamble.`;

  try {
    const response = await fetch(`${process.env.OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2",
        prompt,
        stream: false,
        options: { temperature: 0.3 },
      }),
    });

    const result = await response.json();
    return result.response?.trim() || "No summary available";
  } catch {
    return "Summary generation failed";
  }
}
