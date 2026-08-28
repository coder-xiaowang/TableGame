"use strict";

const searchInput = document.querySelector("#notesSearch");
const tagFilters = document.querySelector("#tagFilters");
const notesList = document.querySelector("#notesList");
const notesCount = document.querySelector("#notesCount");
let notes = [];
let selectedTag = new URLSearchParams(location.search).get("tag") || "";

function formatDate(value) {
  const [year, month, day] = value.split("-");
  return `${Number(month)} 月 ${Number(day)} 日`;
}

function makeElement(name, className, text) {
  const element = document.createElement(name);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderTags() {
  const tags = [...new Set(notes.flatMap((note) => note.tags))].sort((left, right) => left.localeCompare(right, "zh-CN"));
  tagFilters.replaceChildren();

  for (const tag of ["", ...tags]) {
    const button = makeElement("button", tag === selectedTag ? "active" : "", tag || "全部");
    button.type = "button";
    button.dataset.tag = tag;
    button.addEventListener("click", () => {
      selectedTag = tag;
      const url = new URL(location.href);
      if (tag) url.searchParams.set("tag", tag);
      else url.searchParams.delete("tag");
      history.replaceState(null, "", url);
      renderTags();
      renderNotes();
    });
    tagFilters.append(button);
  }
}

function createNoteCard(note) {
  const card = makeElement("article", "note-card");
  const link = makeElement("a", "note-card-link");
  link.href = note.href;

  const top = makeElement("div", "note-card-top");
  top.append(makeElement("time", "note-date", formatDate(note.date)), makeElement("span", "note-mood", note.mood));
  const title = makeElement("h3", "", note.title);
  const summary = makeElement("p", "note-summary", note.summary);
  const footer = makeElement("div", "note-card-footer");
  const tagList = makeElement("div", "note-tags");
  for (const tag of note.tags) tagList.append(makeElement("span", "", `#${tag}`));
  footer.append(tagList, makeElement("span", "read-note", `${note.readingMinutes} 分钟 · 阅读 →`));
  link.append(top, title, summary, footer);
  card.append(link);
  return card;
}

function renderNotes() {
  const query = searchInput.value.trim().toLocaleLowerCase("zh-CN");
  const visible = notes.filter((note) => {
    const matchesTag = !selectedTag || note.tags.includes(selectedTag);
    const haystack = [note.title, note.summary, note.mood, ...note.tags].join(" ").toLocaleLowerCase("zh-CN");
    return matchesTag && (!query || haystack.includes(query));
  });

  notesList.replaceChildren();
  notesCount.textContent = `找到 ${visible.length} 篇记录`;
  if (!visible.length) {
    notesList.append(makeElement("p", "empty-note", "这里暂时没有符合条件的笔记，换个关键词看看吧。"));
    return;
  }

  const years = [...new Set(visible.map((note) => note.year))];
  for (const year of years) {
    const section = makeElement("section", "notes-year");
    const heading = makeElement("h2", "year-heading", year);
    const grid = makeElement("div", "notes-grid");
    for (const note of visible.filter((item) => item.year === year)) grid.append(createNoteCard(note));
    section.append(heading, grid);
    notesList.append(section);
  }
}

async function loadNotes() {
  try {
    const response = await fetch("notes-index.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    notes = await response.json();
    renderTags();
    renderNotes();
  } catch (error) {
    notesList.replaceChildren(makeElement("p", "empty-note", "笔记索引加载失败，请确认已经运行构建脚本并通过本地服务器访问。"));
    notesCount.textContent = "";
    console.error(error);
  }
}

searchInput.addEventListener("input", renderNotes);
loadNotes();

