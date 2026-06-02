// @ts-check
import { defineConfig, fontProviders } from "astro/config";
import starlight from "@astrojs/starlight";
import remarkGfm from "remark-gfm";

export default defineConfig({
  site: "https://kyushu.dev",
  output: "static",
  outDir: "build",
  markdown: {
    remarkPlugins: [remarkGfm],
  },
  devToolbar: {
    enabled: false,
  },
  integrations: [
    starlight({
      title: "Kyushu",
      logo: {
        light: "./src/assets/logo-light.svg",
        dark: "./src/assets/logo-dark.svg",
        replacesTitle: true,
      },
      lastUpdated: !process.env.CI,
      favicon: "/favicon.svg",
      customCss: [
        "@fontsource-variable/nunito-sans/wght.css",
        "./src/styles/font.css",
        "./src/styles/colors.css",
        "./src/styles/code.css",
        "./src/styles/search.css",
        "./src/styles/sidebar.css",
        "./src/styles/nav.css",
        "./src/styles/header.css",
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
