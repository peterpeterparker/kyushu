// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import remarkGfm from "remark-gfm";

const title = "Kyushu";
const description = "A self-hostable Wasm sandbox for JavaScript workers.";

export default defineConfig({
  site: "https://kyushu.dev",
  output: "static",
  outDir: "dist",
  markdown: {
    remarkPlugins: [remarkGfm],
  },
  devToolbar: {
    enabled: false,
  },
  integrations: [
    starlight({
      title,
      description,
      head: [
        { tag: "meta", attrs: { property: "og:title", content: title } },
        { tag: "meta", attrs: { property: "og:description", content: description } },
        {
          tag: "meta",
          attrs: { property: "og:image", content: "https://kyushu.dev/social-image.jpg" },
        },
        { tag: "meta", attrs: { property: "og:type", content: "website" } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "meta", attrs: { name: "twitter:title", content: title } },
        { tag: "meta", attrs: { name: "twitter:description", content: description } },
        {
          tag: "meta",
          attrs: { name: "twitter:image", content: "https://kyushu.dev/social-image.jpg" },
        },
      ],
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: true,
      },
      lastUpdated: true,
      favicon: "/favicon.svg",
      customCss: [
        "@fontsource-variable/nunito-sans/wght.css",
        "./src/styles/font.css",
        "./src/styles/colors.css",
        "./src/styles/layout.css",
        "./src/styles/code.css",
        "./src/styles/search.css",
        "./src/styles/sidebar.css",
        "./src/styles/nav.css",
        "./src/styles/header.css",
        "./src/styles/button.css",
      ],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/peterpeterparker/kyushu" },
      ],
      expressiveCode: {
        themes: ["vesper"],
      },
      sidebar: [
        {
          label: "Start Here",
          items: [{ slug: "getting-started" }, { slug: "how-it-works" }],
        },
        {
          label: "Reference",
          items: [
            { slug: "reference/cli" },
            { slug: "reference/configuration" },
            { slug: "reference/typescript" },
          ],
        },
        {
          label: "Guides",
          items: [{ slug: "guides/static-assets" }, { slug: "guides/deploy" }],
        },
        { slug: "known-limitations" },
        { slug: "security" },
        {
          label: "Examples",
          items: [
            { slug: "examples/hello-world" },
            { slug: "examples/fetch" },
            { slug: "examples/file-system" },
            { slug: "examples/env" },
            { slug: "examples/static-file-server" },
          ],
        },
      ],
      components: {
        Hero: "./src/components/landing/Hero.astro",
        Footer: "./src/components/landing/Footer.astro",
      },
    }),
  ],
});
