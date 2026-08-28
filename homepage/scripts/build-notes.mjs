import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const homepageDirectory = path.resolve(scriptDirectory, "..");
const contentDirectory = path.join(homepageDirectory, "content", "notes");
const notesDirectory = path.join(homepageDirectory, "notes");
const articlesDirectory = path.join(notesDirectory, "articles");
const SITE_NAME = "zillionx 的憩所";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }
  return trimmed.replace(/^['"]|['"]$/g, "");
}

function parseDocument(source, filename) {
  const normalized = source.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    throw new Error(`${filename}: 文件必须以 YAML 风格的 --- 元数据开头。`);
  }

  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) throw new Error(`${filename}: 找不到元数据结束标记 ---。`);

  const metadata = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator < 1) throw new Error(`${filename}: 无法解析元数据行“${line}”。`);
    metadata[line.slice(0, separator).trim()] = parseScalar(line.slice(separator + 1));
  }

  return { metadata, markdown: normalized.slice(end + 5).trim() };
}

function safeUrl(value, { image = false } = {}) {
  const url = value.trim();
  if (image && url.startsWith("media/")) return `../../${url}`;
  if (/^(https?:\/\/|mailto:|#|\/|\.\.\/|\.\/)/i.test(url)) return url;
  if (/^[a-z0-9][a-z0-9/_\-.]*$/i.test(url)) return url;
  return "#";
}

function renderInline(value) {
  const codeTokens = [];
  let output = escapeHtml(value).replace(/`([^`]+)`/g, (_, code) => {
    const token = `\u0000CODE${codeTokens.length}\u0000`;
    codeTokens.push(`<code>${code}</code>`);
    return token;
  });

  output = output.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => (
    `<img src="${escapeHtml(safeUrl(url, { image: true }))}" alt="${alt}" loading="lazy">`
  ));
  output = output.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const href = safeUrl(url);
    const external = /^https?:\/\//i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a href="${escapeHtml(href)}"${external}>${label}</a>`;
  });
  output = output.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  output = output.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  output = output.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");

  return output.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => codeTokens[Number(index)]);
}

function isBlockStart(line) {
  return /^(#{2,4})\s+/.test(line)
    || /^```/.test(line)
    || /^>\s?/.test(line)
    || /^[-*+]\s+/.test(line)
    || /^\d+\.\s+/.test(line)
    || /^---+$/.test(line.trim());
}

function renderMarkdown(markdown) {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const output = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([a-z0-9_-]*)\s*$/i);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : "";
      output.push(`<pre><code${language}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      output.push("<hr>");
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      output.push(`<blockquote><p>${renderInline(quote.join(" "))}</p></blockquote>`);
      continue;
    }

    const unordered = line.match(/^[-*+]\s+(.+)$/);
    if (unordered) {
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^[-*+]\s+(.+)$/);
        if (!item) break;
        items.push(`<li>${renderInline(item[1])}</li>`);
        index += 1;
      }
      output.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\d+\.\s+(.+)$/);
        if (!item) break;
        items.push(`<li>${renderInline(item[1])}</li>`);
        index += 1;
      }
      output.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    output.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return output.join("\n");
}

function validateMetadata(metadata, filename, slug) {
  for (const field of ["title", "date", "summary"]) {
    if (!metadata[field]) throw new Error(`${filename}: 缺少必填字段 ${field}。`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(metadata.date)) {
    throw new Error(`${filename}: date 必须使用 YYYY-MM-DD 格式。`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`${filename}: 文件名只能使用小写英文、数字和连字符。`);
  }
  if (metadata.tags && !Array.isArray(metadata.tags)) {
    throw new Error(`${filename}: tags 必须写成 [标签一, 标签二]。`);
  }
}

function readingMinutes(markdown) {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~\[\]()!\-]/g, " ")
    .replace(/\s+/g, "")
    .trim();
  return Math.max(1, Math.ceil(plain.length / 350));
}

function formatDate(value) {
  const [year, month, day] = value.split("-");
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`;
}

function renderIndexPage() {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="zillionx 的随笔、生活记录与分享。">
    <meta name="theme-color" content="#f6e8ce">
    <title>随笔与记录 · ${SITE_NAME}</title>
    <link rel="stylesheet" href="styles.css">
  </head>
  <body class="notes-index-page">
    <a class="skip-link" href="#notesMain">跳到笔记列表</a>
    <header class="notes-site-header">
      <a class="notes-brand" href="../"><span aria-hidden="true">⌂</span><strong>${SITE_NAME}</strong></a>
      <nav aria-label="笔记导航"><a href="../">返回憩所</a><a class="active" href="./">随笔与记录</a></nav>
    </header>
    <main id="notesMain" class="notes-main">
      <section class="notes-intro">
        <p class="eyebrow">NOTES & MOMENTS</p>
        <h1>随笔与记录</h1>
        <p>收下一些生活碎片、临时冒出的想法，以及值得分享的发现。</p>
      </section>
      <section class="notes-controls" aria-label="查找笔记">
        <label class="search-box"><span aria-hidden="true">⌕</span><span class="sr-only">搜索笔记</span><input id="notesSearch" type="search" placeholder="搜索标题、摘要或标签……" autocomplete="off"></label>
        <div class="tag-filters" id="tagFilters" aria-label="标签筛选"></div>
      </section>
      <p class="notes-count" id="notesCount" aria-live="polite"></p>
      <div id="notesList" class="notes-years"><p class="loading-note">正在整理书页……</p></div>
      <noscript><p class="empty-note">需要启用 JavaScript 才能浏览和筛选笔记列表。</p></noscript>
    </main>
    <footer class="notes-footer"><a href="../">← 回到 zillionx 的憩所</a><small>愿每一次记录，都能留住一点当时的光。</small></footer>
    <script src="app.js"></script>
  </body>
</html>
`;
}

function articleNavigation(note) {
  const links = [];
  if (note.newer) links.push(`<a href="../${note.newer.slug}/"><span>上一篇</span><strong>${escapeHtml(note.newer.title)}</strong></a>`);
  if (note.older) links.push(`<a href="../${note.older.slug}/"><span>下一篇</span><strong>${escapeHtml(note.older.title)}</strong></a>`);
  return links.length ? `<nav class="article-navigation" aria-label="相邻笔记">${links.join("")}</nav>` : "";
}

function renderArticlePage(note) {
  const tags = note.tags.map((tag) => `<a href="../../?tag=${encodeURIComponent(tag)}">#${escapeHtml(tag)}</a>`).join("");
  const updated = note.updated && note.updated !== note.date
    ? `<span>更新于 ${escapeHtml(formatDate(note.updated))}</span>`
    : "";
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${escapeHtml(note.summary)}">
    <meta name="theme-color" content="#f6e8ce">
    <title>${escapeHtml(note.title)} · ${SITE_NAME}</title>
    <link rel="stylesheet" href="../../styles.css">
  </head>
  <body class="article-page">
    <a class="skip-link" href="#articleMain">跳到正文</a>
    <header class="notes-site-header">
      <a class="notes-brand" href="../../../"><span aria-hidden="true">⌂</span><strong>${SITE_NAME}</strong></a>
      <nav aria-label="笔记导航"><a href="../../../">返回憩所</a><a class="active" href="../../">随笔与记录</a></nav>
    </header>
    <main id="articleMain" class="article-main">
      <article class="article-paper">
        <a class="back-to-notes" href="../../">← 返回全部笔记</a>
        <header class="article-header">
          <p class="article-mood">${escapeHtml(note.mood || "随笔")}</p>
          <h1>${escapeHtml(note.title)}</h1>
          <p class="article-summary">${escapeHtml(note.summary)}</p>
          <div class="article-meta"><time datetime="${escapeHtml(note.date)}">${escapeHtml(formatDate(note.date))}</time><span>${note.readingMinutes} 分钟阅读</span>${updated}</div>
          <div class="article-tags">${tags}</div>
        </header>
        <div class="article-content">${note.html}</div>
        <footer class="article-ending"><span aria-hidden="true">❧</span><p>这一页先写到这里。</p></footer>
      </article>
      ${articleNavigation(note)}
    </main>
    <footer class="notes-footer"><a href="../../">← 回到随笔与记录</a><small>${SITE_NAME}</small></footer>
  </body>
</html>
`;
}

async function build() {
  await fs.mkdir(contentDirectory, { recursive: true });
  await fs.mkdir(articlesDirectory, { recursive: true });
  const filenames = (await fs.readdir(contentDirectory)).filter((name) => name.endsWith(".md")).sort();
  const notes = [];

  for (const filename of filenames) {
    const slug = path.basename(filename, ".md");
    const source = await fs.readFile(path.join(contentDirectory, filename), "utf8");
    const { metadata, markdown } = parseDocument(source, filename);
    validateMetadata(metadata, filename, slug);
    if (metadata.draft === true) continue;
    notes.push({
      slug,
      title: String(metadata.title),
      date: String(metadata.date),
      updated: metadata.updated ? String(metadata.updated) : String(metadata.date),
      summary: String(metadata.summary),
      tags: metadata.tags || [],
      mood: metadata.mood ? String(metadata.mood) : "随笔",
      readingMinutes: readingMinutes(markdown),
      html: renderMarkdown(markdown)
    });
  }

  notes.sort((left, right) => right.date.localeCompare(left.date) || left.title.localeCompare(right.title, "zh-CN"));
  for (let index = 0; index < notes.length; index += 1) {
    notes[index].newer = notes[index - 1] || null;
    notes[index].older = notes[index + 1] || null;
  }

  for (const note of notes) {
    const outputDirectory = path.join(articlesDirectory, note.slug);
    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.writeFile(path.join(outputDirectory, "index.html"), renderArticlePage(note), "utf8");
  }

  const index = notes.map(({ html, newer, older, ...note }) => ({
    ...note,
    href: `articles/${note.slug}/`,
    year: note.date.slice(0, 4)
  }));
  await fs.writeFile(path.join(notesDirectory, "notes-index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(notesDirectory, "index.html"), renderIndexPage(), "utf8");
  console.log(`Built ${notes.length} published note(s) in ${path.relative(process.cwd(), notesDirectory)}.`);
}

build().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});

