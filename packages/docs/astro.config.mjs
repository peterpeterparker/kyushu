// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import remarkGfm from "remark-gfm";

export default defineConfig({
  site: "https://kyushu.dev",
  output: "static",
  outDir: "build",
  markdown: {
    remarkPlugins: [remarkGfm],
  },
  integrations: [
    starlight({
      title: "Kyushu",
      customCss: [
        "./src/styles/colors.css",
        "./src/styles/code.css",
        "./src/styles/search.css",
        "./src/styles/sidebar.css",
        "./src/styles/nav.css",
      ],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/peterpeterparker/kyushu" },
      ],
      expressiveCode: {
        themes: ["vesper"],
      },
      sidebar: [
        { label: "Start Here", items: [{ slug: "getting-started" }] },
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
          items: [{ slug: "guides/deploy" }],
        },
        { slug: "known-limitations" },
      ],
    }),
  ],
});
