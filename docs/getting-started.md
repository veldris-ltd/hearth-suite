# Getting started with Hearth Suite

Hearth Suite is an open-source, offline-first, privacy-first productivity suite, the
modern heir to Microsoft Works. It works with **no account, no network, and no
cost**. This guide gets you from install to your first sealed Bundle.

## 1. Install

Download the signed installer for your platform from the releases page:

| Platform | Installer |
| -------- | --------- |
| Windows  | `.msi` |
| macOS    | `.dmg` |
| Linux    | `.AppImage` or `.deb` |
| iOS / Android | App Store / Google Play, or the F-Droid / sideload build on Android |

Every installer is **code-signed** and carries a **SLSA provenance attestation**
and an **SBOM**; updates are verified against pinned signing roots before they
install (see `docs/build/gates/desktop-packaging.md`).

> No sign-up, no licence key. Hearth Suite opens straight into **The Mantel**.

## 2. The Mantel, your home

The Mantel is the calm home surface. It asks "what do you want to do?" and offers:

- **Quick create**, Writer, Sheets, Records, or Calendar.
- **Universal search** across your documents, records, and calendar.
- **Recent Bundles**, each showing a plain-language **Sealed** indicator.

## 3. Your first document

1. From The Mantel, choose **Write a document**. A new **Bundle** is created.
2. Type. Everything is saved locally and encrypted at rest, nothing leaves your
   device.
3. Try **Ember** (the on-device assistant): draft, rewrite, summarise, or "ask
   your document". Ember runs entirely on your device, it has no network path.

## 4. Seal it (post-quantum end-to-end encryption)

Click **Seal** and choose who can open it. Hearth Suite encrypts the Bundle so that
**only you and the people you choose** can open it, using a hybrid
post-quantum scheme. The status always reads in plain language, e.g.
_"Only you and Maria can open this."_ No keys, no jargon.

## 5. Open formats, your data is yours

Documents are OpenDocument (ODF) under the hood and export to `.docx`/`.xlsx`/PDF.
A **Bundle** is an open, signed archive you can back up or move anywhere.

## 6. On-device AI (Ember)

Ember uses a local model. On a fresh install it defaults to the smallest viable
tier; you can download a larger model **only over Wi-Fi, only with your consent**.
Nothing you write is ever sent to a server.

## Next steps

- [User guide](user-guide.md), every module in depth.
- [Self-hosting the optional cloud](self-hosting.md), run your own sync relay.
- [Contributing](../CONTRIBUTING.md), build Hearth Suite with us.
- [Security & threat model](security/threat-model.md).
