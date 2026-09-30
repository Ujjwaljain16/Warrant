# Security policy

`warrant` is a research project, not a hardened product. Please read [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) for what it does and
does not protect against. In particular: command workers run as the invoking user without an OS sandbox, and specs given to the MCP
server are trusted code.

To report a vulnerability, use GitHub's private vulnerability reporting for this repository
(Security tab, "Report a vulnerability"), or open an issue that contains no exploit details and ask for a private channel.
Please do not include API keys, tokens or personal data in any report.
