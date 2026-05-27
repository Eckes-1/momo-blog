# LiHui Blog

<div align="center">
    <img src="./images/index-light-en.jpg">
    <p>With solid roots, ideas blossom into light — A personal blog built with <a href="https://astro.build/">Astro</a></p>
    <small><a href="../README.md">简体中文</a></small> <small><ins>English</ins></small>
</div>


## ✨ Features

LiHui Blog — "Li" signifies taking firm root, "Hui" signifies radiating brilliance. With solid roots, ideas blossom into light.

* **Minimalist Design**: Clean page layout with black and white as primary colors, accented by blue
* **Dark Mode**: Supports manual switching or automatic system adaptation
* **Article Search**: Implements localized search using [pagefind](https://pagefind.app/)
* **Internationalization (i18n)**: Supports multilingual switching, currently available in Simplified Chinese and English
* **Mobile Adaptation**: Components optimized for mobile devices, delivering the same experience as desktop browsers
* **Commenting**: Supports local deployment and Cloudflare deployment
* **Extensive Markdown syntax**: Supports Katex, Typst, and Alert components, GitHub cards, custom syntax, and more
* Other core features: Article categories, directory, RSS subscription, text statistics, reading time

## 🚀 Quick Start

1. Clone this project
    ```bash
    git clone https://github.com/Eckes-1/lihui-blog.git
    cd lihui-blog
    ```
2. Run `pnpm install` to install dependencies (use `npm install -g pnpm` to install `pnpm`)
3. Run `pnpm dev` to start the development server

## 🔧 Configuration

Refer to the [Configuration Guide](./config_en.md). For detailed information, visit [LiHui Blog](https://eckes.de5.net/en/intro/config) and read the corresponding articles.

## 📚 Updating

Refer to the [Update Guide](./release_en.md) for instructions on updating your project. Visit [LiHui Blog](https://eckes.de5.net/en/intro/release) for detailed information.

## ⚡ Commands

All commands below can be executed in the root directory

| Command | Function |
| --- | --- |
| `pnpm install` | Install dependencies |
| `pnpm dev` | Start local server at `http://localhost:4321` |
| `pnpm build` | Build release version to `./dist` directory |
| `pnpm preview` | Preview built release version |
| `pnpm astro ...` | Run `astro` commands, e.g., `astro add` |
| `pnpm newpost <path> <lang>` | Create a new post, e.g., `pnpm newpost docs/test.md zh-cn`. Language can be omitted; defaults to `zh-cn` |


## 📚 References

* [Astro](https://astro.build/)
* [Fuwari](https://github.com/saicaca/fuwari)
* [Tyndall](https://github.com/moyuin-aka/tyndall-public)
