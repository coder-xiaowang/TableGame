import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const endpoint = "https://v1.jinrishici.com/all.json";
const repo = fileURLToPath(new URL("../../", import.meta.url));
const calendar = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", dateStyle: "short" });

export const previewCacheDir = path.join(tmpdir(), "tablegame-daily-poem");
export const cacheName = "daily-poem.json";

function hasPoem(entry) {
  return [entry?.content, entry?.author, entry?.origin].every(
    value => typeof value === "string" && value.trim().length > 0
  );
}

export async function updatePoem(directory, { fetchPoem = fetch, now = () => new Date() } = {}) {
  const relative = path.relative(repo, path.resolve(directory));
  if (!(relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))) {
    throw new Error("请选择 Git 工作目录之外的缓存目录");
  }
  const file = path.join(directory, cacheName);
  const today = calendar.format(now());
  try {
    const previous = JSON.parse(await readFile(file, "utf8"));
    if (previous?.date === today && hasPoem(previous)) return "已存在 " + today;
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }

  const response = await fetchPoem(endpoint, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`诗词接口返回 HTTP ${response.status}`);
  const poem = await response.json();
  if (!hasPoem(poem)) throw new Error("诗句、作者或篇名缺失");
  const entry = {
    date: calendar.format(now()),
    content: poem.content.trim(),
    author: poem.author.trim(),
    origin: poem.origin.trim()
  };
  await mkdir(directory, { recursive: true });
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(entry) + "\n", { flag: "wx", mode: 0o644 });
    // Nginx runs as a separate user even if the scheduler has a private umask.
    await chmod(temporary, 0o644);
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
  return "已更新 " + entry.date;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    console.log(await updatePoem(process.env.DAILY_POEM_DIR || previewCacheDir));
  } catch (error) {
    console.error("今日一页更新失败：", error.message);
    process.exitCode = 1;
  }
}
