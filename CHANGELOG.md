# Changelog

All notable changes to `@ontomorph/dtp-sdk` are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.3] - Unreleased

### Added

- `twin.simulate(simulationType, params)` — run a what-if trajectory
  simulation. Polls a queued real-twin job to completion (or throws on
  failure/timeout), resolves immediately against the sandbox host. Returns
  scalar outputs, disclaimer, and (on a real twin) AI narration + 3D
  animation.

## [0.1.2] - 2026-07-19

### Added

- `dtp.sandbox.grants()` — mint fresh grant tokens for the standing synthetic
  sandbox cohort. User-authed (`sessionToken`), pairs with a `dtp_test_…` API
  key.

### Docs

- Corrected a stale public docs sample that showed `dtp.grants.create()` /
  `.revoke()` — verified against every published tarball back to 0.1.0: these
  methods never shipped in any SDK version, the sample was simply wrong. Real
  grants are patient-consent-only; third-party apps never create or revoke
  them directly. Docs now show `decodeGrantToken` (a real export) to inspect
  what a token already authorizes, plus `dtp.sandbox.grants()` or the
  developer dashboard for sandbox testing.

## [0.1.1] and earlier

Not tracked in this file — see npm's version history for
[@ontomorph/dtp-sdk](https://www.npmjs.com/package/@ontomorph/dtp-sdk?activeTab=versions).
