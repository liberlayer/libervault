// monero-javascript ships no TypeScript definitions. We use it via a thin wrapper
// in xmr-wallet.ts; declaring the module here makes its surface explicitly `any`
// (so noImplicitAny passes) without pretending to type the whole WASM library.
declare module "monero-javascript";
