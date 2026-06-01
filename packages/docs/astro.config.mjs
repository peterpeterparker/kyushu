// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://kyushu.dev",
  output: "static",
  outDir: "build",
  integrations: [
    starlight({
      title: "Kyushu",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/peterpeterparker/kyushu" },
      ],
      sidebar: [
        {
          label: "Guides",
          items: [
            // Each item here is one entry in the navigation menu.
            { label: "Example Guide", slug: "guides/example" },
          ],
        },
        {
          label: "Reference",
          items: [{ autogenerate: { directory: "reference" } }],
        },
      ],
    }),
  ],
});
