# Contrib Coverage Runner

Contributor-local coverage tooling for issue #520. The root package manifest is
intentionally untouched; install and run this private package from the
repository root:

```sh
npm install --prefix contrib/coverage-runner
npm run --prefix contrib/coverage-runner coverage
```

The test selection and V8 instrumentation are limited to `src/` and
`packages/*/src/`. Tests under `contrib/`, integration tests, and load tests
are excluded. Text and HTML reports are written beneath
`contrib/coverage-runner/report/`. Reports are emitted even if a selected test
suite fails to parse, so such failures must be noted when interpreting the
baseline.