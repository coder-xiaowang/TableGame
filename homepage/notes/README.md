# 随笔与记录：写作与发布

笔记源文件放在 `homepage/content/notes/`，公开页面由构建脚本生成到 `homepage/notes/`。构建过程只使用 Node.js 内置模块，不需要执行 `npm install`。

## 新建一篇笔记

在 `homepage/content/notes/` 新建一个 Markdown 文件。文件名会成为网址，建议只使用小写英文、数字和连字符，例如：

```text
my-first-note.md
reading-in-august.md
```

文件内容模板：

```md
---
title: 笔记标题
date: 2026-08-28
updated: 2026-08-28
summary: 一句话介绍这篇笔记，显示在集合页。
tags: [生活, 阅读]
mood: 平静
draft: false
---

这里开始写正文。

## 二级标题

- 支持列表
- 支持 **粗体**、*斜体*、`行内代码`

> 也支持引用。
```

规则：

- `title`、`date`、`summary` 必填。
- 日期必须写成 `YYYY-MM-DD`。
- `draft: true` 表示草稿，不会生成到公开列表。
- 文件名只能使用小写英文、数字和连字符。
- 原始 HTML 会作为普通文字处理，避免意外插入脚本。

## 插入图片

把图片放进 `homepage/notes/media/`，然后在 Markdown 中写：

```md
![图片说明](media/example.jpg)
```

构建器会自动调整详情页中的相对路径。

## 构建与本地预览

在项目根目录执行：

```powershell
node homepage/scripts/build-notes.mjs
node homepage/scripts/serve.mjs
```

浏览器打开：

```text
http://127.0.0.1:4173/homepage/
http://127.0.0.1:4173/homepage/notes/
```

每次修改或新增 Markdown 后，需要重新运行构建命令。预览服务器不需要重启，刷新浏览器即可。

## 发布到服务器

### 方式一：本地构建后上传（推荐）

1. 在本地运行 `node homepage/scripts/build-notes.mjs`。
2. 确认本地预览正常。
3. 将整个 `homepage/` 目录上传到服务器原本托管主页的位置，必须同时包含：
   - `homepage/content/notes/`：笔记源文件，方便备份；
   - `homepage/notes/`：浏览器实际访问的生成页面；
   - `homepage/assets/`：背景和主页图片。
4. 静态文件更新通常不需要重启 Nginx，上传完成后刷新网页即可。

Linux/macOS 可以使用类似命令，目标路径请替换为服务器真实目录：

```bash
rsync -av homepage/ user@example.com:/var/www/zillionx/homepage/
```

Windows 也可以使用 `scp`、WinSCP 或服务器面板上传整个目录。

### 方式二：服务器拉取代码后构建

服务器已经安装 Node.js，并通过 Git 更新项目时，可以在服务器项目根目录执行：

```bash
git pull
node homepage/scripts/build-notes.mjs
```

构建结束后同样不需要启动额外的笔记服务，因为生成结果都是静态文件。

## 删除或重命名笔记

删除源 Markdown 后重新构建，笔记会从索引中消失。为了避免构建器误删用户文件，旧的详情目录不会自动删除；如需彻底移除，请手动删除：

```text
homepage/notes/articles/旧文件名/
```

