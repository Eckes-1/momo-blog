---
title: Deploying a Comment System
pubDate: 2026-01-08
description: Website Configuration
category: Instruction
image: ""
draft: false
slugId: lihui/intro/comment
---

LiHui Blog supports adding comment functionality and offers two deployment methods, including serverless deployment. For details, visit the repository [lihui-blog](https://github.com/Eckes-1/lihui-blog).

::github{repo="Eckes-1/lihui-blog"}

## Configuration

To enable comments, first deploy the backend comment system as detailed in the lihui-blog repository.

After deployment, set `comments.enable` to `true` in `src/config.ts` and specify `comments.backendUrl` with the backend URL to activate comments.

## Operation

The comment component is written in Svelte. Similar to most comment systems, users must enter a nickname and email address (for notifications) to post comments. They may optionally provide a website URL.

## Custom Frontend

If you need to use the comment feature in other projects, you can directly import it via CDN. The usage method is as follows. For details, please refer to the repository [lihui-blog](https://github.com/Eckes-1/lihui-blog).

```html
<div id="lihui-comment"></div>
<script src="https://cdn.jsdelivr.net/npm/@eckes/lihui-comment@1.3.x/dist/lihui-comment.min.js"></script>
<script>
    lihui.init({
        el: '#lihui-comment',
        title: 'Test',
        slugId: 'blog/test',
        lang: 'zh-cn',
        apiUrl: 'https://eckes.de5.net/api'
    });
</script>
```

> We recommend using version numbers to lock the version to avoid conflicts caused by updates.

The comment system also provides a backend management interface supporting comment moderation and deletion.

## Custom Styles

Currently, you can modify the colors of the comment component; custom style features will be released in the future. Colors are modified by setting global variables, and dark mode is supported.

```css
:root {
    --lihui-text-color: #d51111;            /* Text color */
    --lihui-button-border-color: #e5e5e5;   /* Button border color */
    --lihui-button-hover-bg-color: #f5f5f5; /* Button background color (hover state) */
    --lihui-link-color: #003b6e;            /* Link color */
}
/* Dark mode */
[data-theme="dark"] {
    --lihui-text-color: #3ad8d8;
    --lihui-button-border-color: #2e2e2e;
    --lihui-button-hover-bg-color: #3c3c3c;
    --lihui-link-color: #fff;
}
```
