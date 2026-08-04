import fs from "node:fs/promises";
import path from "node:path";

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function iconParts(file) {
  const name = path.basename(file, ".svg");
  const style = name.endsWith("-fill") ? "fill" : "line";
  const stem = name.replace(/-(line|fill)$/, "");
  return { name, stem, style, tokens: stem.split("-").filter(Boolean) };
}

export function rankRemixIconFiles(files, query, style = "line", limit = 8) {
  const normalizedQuery = normalize(query);
  const queryTokens = normalizedQuery.split("-").filter(Boolean);
  if (!queryTokens.length) return [];

  return files
    .map((file) => {
      const icon = iconParts(file);
      const matched = queryTokens.filter((token) => icon.tokens.includes(token)).length;
      const partial = queryTokens.filter((token) => icon.stem.includes(token)).length;
      let score = matched * 20 + partial * 4;
      if (icon.stem === normalizedQuery) score += 100;
      if (icon.stem.startsWith(`${normalizedQuery}-`) || normalizedQuery.startsWith(`${icon.stem}-`)) score += 30;
      if (icon.style === style) score += 8;
      score -= Math.abs(icon.tokens.length - queryTokens.length);
      return { ...icon, file: path.resolve(file), category: path.basename(path.dirname(file)), score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, Math.max(1, Number(limit) || 8));
}

async function listSvgFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return listSvgFiles(target);
    return entry.isFile() && entry.name.endsWith(".svg") ? [target] : [];
  }));
  return nested.flat();
}

export async function findRemixIcons({ packageRoot, query, style = "line", limit = 8 }) {
  const iconsDir = path.join(packageRoot, "icons");
  return rankRemixIconFiles(await listSvgFiles(iconsDir), query, style, limit);
}
