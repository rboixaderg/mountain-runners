export type BoardMember = {
  name: string;
  role: string;
};

export function parseBoardMembers(markdown: string): BoardMember[] {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => {
      const match = line.match(/^- \*\*(.+?)\*\* — (.+)$/u);
      if (match === null) {
        throw new Error(`Invalid board member line: ${line}`);
      }

      return {
        name: match[1]!,
        role: match[2]!,
      };
    });
}
