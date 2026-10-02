# Compatibility

## Peer dependencies

The library has no runtime dependencies of its own. Everything it needs is a peer dependency that
the host application provides.

| Peer | Supported range |
| --- | --- |
| `@nestjs/common`, `@nestjs/core` | `^11.0.0 \|\| ^12.0.0` |
| `@confluentinc/kafka-javascript` | `^1.10.0` |
| `reflect-metadata` | `^0.2.0` |
| `@kafkajs/confluent-schema-registry` (optional, for Avro) | `>=3.0.0` |

CI runs the type check, unit tests, and build against both NestJS 11 and NestJS 12, the
integration tests against NestJS 12, checks that both entry points of the built package load on
Node.js 20.19 and 22.12, and checks that the ES module entry loads on Node.js 20.18 and 22.11.

## Module formats

The package ships one implementation, compiled as ES modules, behind an `exports` map. `import`
resolves to the ES module build; `require` resolves to a CommonJS entry that loads that same build.
Both hand out the same classes, so a host that reaches the package through both still has a single
`ConsumerProxy` and `ProducerProxy`. Only the package root is exported: deep imports such as
`nestjs-kafka-connector/dist/...` are not available.

## Node.js versions

`engines` declares Node.js `^20.19.0` or `>=22.12.0`. That is exact for a CommonJS host, whose
`require` of this package loads ES modules through Node's `require(esm)` support, unflagged from
those versions. An ES module host needs nothing extra from this package and also runs on earlier
Node.js 20 and 22 releases, verified on 20.18 and 22.11, where npm only warns about `engines`.

`@confluentinc/kafka-javascript` (`1.10.1`) ships prebuilt native binaries only for Node.js 18, 20,
21, 22, 23, and 24, on darwin (arm64/x64), linux glibc and musl (arm64/x64), and win32 (x64). On
those platforms the install needs no local build toolchain. On any other Node.js version — Node.js
25 or 26, for example — `npm install` falls back to compiling librdkafka from source, which needs a
working C++ toolchain on the machine running the install.

## TypeScript

The `import` and `require` conditions each have declarations in their own module format. With
`skipLibCheck: false`, NestJS 11 and 12, ES module and CommonJS hosts, and `"moduleResolution"` set
to `"node16"`, `"nodenext"`, or `"bundler"` all type-check cleanly, with one exception: a CommonJS
host on NestJS 12 under `"node16"`, or under `"nodenext"` with TypeScript 5.7 or older. There the
host's own imports of the ESM-only NestJS 12 packages fail with `TS1479`, and this package's
declarations report the same. Use `"nodenext"` with TypeScript 5.8 or newer, or `"bundler"`.

## Testing with Jest

Jest runs tests in its own module sandbox, which cannot `require` ES modules unless Jest 30 runs
on Node.js 24.9 or newer with `--experimental-vm-modules`. A CommonJS host that tests with the
Nest CLI's default Jest setup therefore needs one of two changes. Run Jest with the flag:

```sh
node --experimental-vm-modules node_modules/jest/bin/jest.js
```

or let ts-jest transpile this package to CommonJS:

```js
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: {
          allowJs: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
        },
      },
    ],
  },
  transformIgnorePatterns: ['node_modules/(?!nestjs-kafka-connector/)'],
};
```

A NestJS 12 host needs the flag either way, because NestJS 12 is itself published as ES modules
only.
