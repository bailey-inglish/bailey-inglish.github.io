// the legacy build ships the same API surface as the main entry but has no
// type declarations of its own
declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export * from 'pdfjs-dist'
}
