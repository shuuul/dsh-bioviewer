/**
 * Ambient declaration for stylesheet imports.
 *
 * `scripts/build.ts` registers a `css-as-text` Bun plugin that inlines every
 * `.css` file as a string default export, so the client bundle can inject its
 * styles from inside the module-loader factory instead of shipping a separate
 * asset (the DSH web shell only serves one script per plugin entry).
 */
declare module "*.css" {
  const css: string;
  export default css;
}
