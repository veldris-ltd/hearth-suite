// Flat ESLint config for the Hearth Suite TypeScript workspace.
// `just lint` runs `eslint .` with `--max-warnings 0`, so warnings fail CI.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    // Not linted: build output, deps, the Rust tree, generated docs.
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/*.d.ts",
      "target/**",
      "crates/**",
      "docs/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node tooling/test scripts run on the Node runtime, not in the browser.
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
        Buffer: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
  },
  {
    // The design-system gallery is browser code (served by Vite), not Node.
    files: ["packages/design-system/gallery/**/*.mjs"],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
        getComputedStyle: "readonly",
        requestAnimationFrame: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
  {
    // The marketing site chrome (site/scripts/*.js) is plain browser code.
    files: ["site/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
        navigator: "readonly",
        location: "readonly",
        history: "readonly",
        localStorage: "readonly",
        matchMedia: "readonly",
        IntersectionObserver: "readonly",
        requestAnimationFrame: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        performance: "readonly",
        console: "readonly",
      },
    },
    rules: {
      // The marketing chrome uses short-circuit guards (`el && el.addEventListener`).
      "no-unused-expressions": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  // Disables stylistic rules that Prettier owns; must come last.
  prettier,
);
