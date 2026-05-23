// Allow `import "foo.css"` side-effect imports in TypeScript.
// Next.js/Turbopack handles the actual bundling; this declaration exists so
// `tsc --noEmit` doesn't fail with TS2882 on the bare specifier import.

declare module "*.css";
declare module "*.scss";
