export function parseKeywords(value: string): string[] {
  const seen = new Set<string>();
  return value.split(/[,\r\n]+/).map(s => s.trim().replace(/\s+/g, ' ')).filter(keyword => {
    const normalized = keyword.toLowerCase();
    if (!keyword || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
