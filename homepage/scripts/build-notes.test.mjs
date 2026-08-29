import assert from "node:assert/strict";
import test from "node:test";
import { renderInline, renderMarkdown } from "./build-notes.mjs";

test("renders all six ATX heading levels and setext headings",()=>{
  const markdown=["# H1","## H2","### H3","#### H4","##### H5","###### H6","","Setext one","===","","Setext two","---"].join("\n");
  const html=renderMarkdown(markdown);
  for(let level=1;level<=6;level+=1)assert.match(html,new RegExp(`<h${level}>H${level}</h${level}>`));
  assert.match(html,/<h1>Setext one<\/h1>/);assert.match(html,/<h2>Setext two<\/h2>/);
});

test("renders common inline syntax without allowing raw HTML",()=>{
  const html=renderInline("**bold** __strong__ *italic* _also_ ***both*** ~~gone~~ `code` [link](https://example.com \"title\") <https://openai.com> https://example.org <script>");
  assert.match(html,/<strong>bold<\/strong>/);assert.match(html,/<strong>strong<\/strong>/);assert.match(html,/<em>italic<\/em>/);assert.match(html,/<em>also<\/em>/);assert.match(html,/<strong><em>both<\/em><\/strong>/);assert.match(html,/<del>gone<\/del>/);assert.match(html,/<code>code<\/code>/);assert.match(html,/title="title"/);assert.match(html,/href="https:\/\/openai.com"/);assert.match(html,/href="https:\/\/example.org"/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});

test("renders tables, tasks, lists, quotes, rules and both fenced code styles",()=>{
  const markdown=[
    "| 左 | 中 | 右 |", "| :--- | :---: | ---: |", "| A | B | C |", "",
    "- [x] 完成", "  - 子任务", "- [ ] 待办", "", "3. 第三项", "   1. 嵌套编号", "4. 第四项", "",
    "> 引用中的 **重点**", "", "***", "", "```js", "const x = '<safe>';", "```", "", "~~~text", "hello", "~~~"
  ].join("\n");
  const html=renderMarkdown(markdown);
  assert.match(html,/<table>/);assert.match(html,/text-align:center/);assert.match(html,/class="task-list"/);assert.match(html,/checked/);assert.match(html,/<ul><li>子任务<\/li><\/ul>/);assert.match(html,/<ol start="3">/);assert.match(html,/<ol><li>嵌套编号<\/li><\/ol>/);assert.match(html,/<blockquote><p>引用中的 <strong>重点<\/strong><\/p><\/blockquote>/);assert.match(html,/<hr>/);assert.match(html,/class="language-js"/);assert.match(html,/&lt;safe&gt;/);assert.match(html,/class="language-text"/);
});

test("renders hard line breaks, images and escaped Markdown characters",()=>{
  const html=renderMarkdown("第一行  \n第二行\\\n第三行\n\n![说明](media/photo.jpg \"照片\")\n\n\\*不是斜体\\*");
  assert.match(html,/第一行<br>\s*第二行<br>\s*第三行/);assert.match(html,/src="\.\.\/\.\.\/media\/photo.jpg"/);assert.match(html,/title="照片"/);assert.match(html,/\*不是斜体\*/);assert.doesNotMatch(html,/<em>不是斜体<\/em>/);
});
