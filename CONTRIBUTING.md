# Contributing

Issues and pull requests are welcome for the client libraries (`clients/js`, `clients/python`) and the docs.

- Bugs in the hosted API (getcourier.dev): open an issue with the request, the response status and body, and the time (UTC).
- Security reports: please use GitHub's private vulnerability reporting on this repository, not a public issue.
- Client changes: keep them dependency-free and run the selftest (`node test/selftest.js` or `python3 tests/selftest.py`).

`legacy/` is frozen and does not accept changes.
