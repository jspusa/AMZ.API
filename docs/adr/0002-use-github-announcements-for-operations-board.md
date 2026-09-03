# Use GitHub announcements for the Operations Bulletin Board

Status: Superseded by [ADR 0003](./0003-use-supply-boss-for-operations-board.md).

This document records the v0.1.49／v0.1.50 historical design only. The next unreleased implementation no longer creates, edits, or closes GitHub Issues for board data.

The shared Operations Bulletin Board uses authorized GitHub Issues as its free write source and publishes a generated read-only JSON snapshot with the Control Console. Operators fill a plain-language form in AMZ.API and use GitHub only for the final publish confirmation; editing or closing the source Issue changes or withdraws the announcement. This replaces the R2 writer setup and custom board password because the user chose zero infrastructure and GitHub identity over fully in-app submission, while generated output still rejects Issues from unaffiliated public users.

## Considered options

- R2 offered direct conditional writes but required five connection fields and separate administrator verification.
- A GitHub OAuth application could keep submission inside AMZ.API but would add application registration and token lifecycle work.
- Authorized GitHub Issues require one final browser confirmation but need no storage account, server, custom password, or embedded write credential.

## Consequences

Board announcement fields are public repository data even though the AMZ.API console remains protected by the Notebook Key. Amazon credentials, live inventory, live price, and administrator passwords never become announcement fields.
