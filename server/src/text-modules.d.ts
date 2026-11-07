// Installer scripts are bundled as text (see [[rules]] in wrangler.toml and
// vitest.config.ts).
declare module "*.sh" {
  const content: string;
  export default content;
}
declare module "*.ps1" {
  const content: string;
  export default content;
}
