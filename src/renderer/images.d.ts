/**
 * A picture imported for its address.
 *
 * Vite answers `import mark from './x.png'` with the URL it emitted the file
 * at — hashed, and copied into the build — which is what puts a file in the
 * repository into the packaged app without anything having to be told about it
 * twice. TypeScript knows nothing of that on its own, and this project does not
 * pull in `vite/client` (which brings a great deal else with it), so the one
 * shape actually used is declared here.
 */
declare module '*.png' {
  const src: string
  export default src
}
