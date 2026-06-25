<div align="center">

# 🛡️ LiberVault

**Hold your keys. Control your assets.**

**Non-Custodial. Private. Chain-Agnostic.**

A browser extension wallet leading with Cardano (ADA) — plus Ethereum/EVM, Bitcoin, Solana, Polkadot, and Monero, with Liberland support.

[![License](https://img.shields.io/badge/license-GPL--v3-blue)](LICENSE)
[![Chains](https://img.shields.io/badge/chains-7%20networks-d23a63)](#supported-chains)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-informational)](#architecture)
[![Website](https://img.shields.io/badge/website-libervault.com-blue)](https://libervault.com)

</div>

---

## Overview

LiberVault is a non-custodial browser extension wallet built on Chrome Manifest V3.

It leads with Cardano (ADA) and is chain-agnostic by design: one BIP-39 seed phrase deterministically derives addresses across every supported network.

Your keys are encrypted locally using AES-256-GCM and never leave your device.

There are no servers. No accounts. No tracking.

Alongside Cardano, LiberVault supports Ethereum/EVM, Bitcoin, Solana, Polkadot, and Monero (full send/receive via ring-signature WASM), plus native support for the Liberland Blockchain (LLD + LLM).

---

## Why LiberVault

- You hold your keys — always  
- No backend, no accounts, no data collection  
- One seed phrase across multiple chains  
- Built for control, not custody  

---

## Supported Chains

| Chain | Symbol | Family | Derivation | Send | Receive | Balance |
|---|---|---|---|---|---|---|
| Cardano | ADA | Cardano | m/1852'/1815'/0'/{0,2}/0 · Ed25519-BIP32 (CIP-1852) | ✅† | ✅ | ✅ |
| Ethereum + EVM | ETH | EVM | m/44'/60'/0'/0/0 · secp256k1 | ✅ | ✅ | ✅ |
| Polygon, BSC, Arbitrum, Base | MATIC/BNB/ETH | EVM | Same key, different RPC | ✅ | ✅ | ✅ |
| Bitcoin | BTC | UTXO | m/84'/0'/0'/0/0 · native SegWit | ✅ | ✅ | ✅ |
| Solana | SOL | Solana | m/44'/501'/0'/0' · ed25519 | ✅ | ✅ | ✅ |
| Polkadot | DOT | Substrate | sr25519 · SS58 prefix 0 | ✅ | ✅ | ✅ |
| Liberland | LLD + LLM | Substrate | sr25519 · SS58 prefix 56 | ✅ | ✅ | ✅ |
| Monero | XMR | Monero | m/44'/128'/0'/0/0 · ed25519 | ✅ | ✅ | ✅ |

> Liberland: LLD (Liberland Dollar) and LLM (Liberland Merit) share the same address — same keypair, separate asset IDs on-chain.  
> Monero: Full RingCT transaction construction via monero-javascript WASM. Spend key never leaves the extension. View key is used for output scanning against a configurable remote node.  
> Cardano: Pure-TypeScript derivation + Shelley address + transaction building via `@stricahq` (no WASM). Balance via Koios. †Send is implemented and compiles, pending preprod-testnet verification before mainnet reliance.

---

## Security Model

### Encryption & Storage
- AES-256-GCM encryption  
- Vault stored locally in chrome.storage.local  
- No external storage or transmission  

### Key Derivation
- PBKDF2 — 600,000 iterations (SHA-256)  
- Derives encryption key from user password  

### Key Handling
- Decrypted keys live only in memory  
- Stored in MV3 background service worker  
- Never exposed to popup or content scripts  

### Isolation
- UI sends signing requests only  
- No key material leaves the background context  

### Cryptography
- @scure/bip39, @scure/bip32, @noble/curves  
- Audited libraries, no Node shims  

### Compatibility
- EIP-6963 multi-wallet discovery  
- Coexists with MetaMask and other wallets  

### Monero
- Spend key never exposed externally  
- View key used only for scanning via configured node  

---

## Architecture

~~~text
src/
├── background/          # MV3 service worker — secure key store, signing, broadcasting
├── content/             # Content script — bridges inpage provider ↔ background
├── inpage/              # Injected into every page (window.ethereum, window.solana)
├── assets/              # Monero WASM binary + worker (monero_wallet_full.wasm)
├── lib/
│   ├── keyring.ts       # BIP-39/44/84, SLIP-0010, sr25519, Monero key derivation
│   ├── storage.ts       # AES-256-GCM encrypted chrome.storage.local
│   ├── messages.ts      # Typed message bus (popup ↔ background ↔ inpage)
│   ├── balance.ts       # Balance fetching for all chains
│   ├── send.ts          # Transaction building & broadcasting
│   └── xmr-wallet.ts    # Monero wallet session (WASM, sync, ring sigs)
├── popup/               # React UI — JetBrains Mono, terminal aesthetic
│   ├── views/           # Welcome, Create, Import, Seed, Lock, Dashboard, Send, Receive
│   ├── components/      # Shared UI components
│   └── ui.ts            # Design tokens
└── store/               # Zustand state (balances, send, modal, chain tab)
~~~

---

## Getting Started

### Prerequisites

- Node.js 18+  
- Chrome, Brave, or Edge (Manifest V3)  

---

### Install & Build

~~~bash
git clone https://github.com/liberlayer/libervault.git
cd libervault
npm install
npm run build
~~~

---

### Load in Chrome

1. Go to chrome://extensions  
2. Enable Developer mode  
3. Click Load unpacked  
4. Select the dist/ folder  
5. LiberVault icon appears in toolbar  

---

### Development

~~~bash
npm run dev
~~~

Auto-rebuilds on save. Refresh the extension to reload.

---

## Roadmap

- [x] Wallet core — seed generation, encryption, HD derivation, lock/unlock  
- [x] Send/receive — balances, fee estimation, confirmations, QR receive  
- [ ] Token support — ERC-20, SPL, Substrate assets  
- [ ] Transaction history + fiat pricing  
- [ ] Custom RPC configuration  
- [ ] Monero enhancements — subaddresses, view key export  
- [ ] Hardware wallets (Ledger)  
- [ ] WalletConnect v2  
- [ ] Firefox support  
- [ ] Independent security audit  

---

## Contributing

PRs welcome. Open an issue first for significant changes.

---

## Website

https://libervault.com

---

## License

GPL v3 — see [LICENSE](LICENSE)

This means any distribution of modified versions must also be open source.