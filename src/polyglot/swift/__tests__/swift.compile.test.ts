import {execFileSync, spawnSync} from 'node:child_process'
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'

import {type SchemaType} from 'groq-js'
import {describe, expect, test} from 'vitest'

import {swiftGenerator} from '../index.js'

const fixtureUrl = new URL('../../__fixtures__/kitchen-sink-schema.json', import.meta.url)

function hasSwift(): boolean {
  try {
    execFileSync('swift', ['--version'], {stdio: 'ignore'})
    return true
  } catch {
    return false
  }
}

const SWIFT_AVAILABLE = hasSwift()

describe.skipIf(!SWIFT_AVAILABLE)('swift build (toolchain)', () => {
  test('generated Swift output compiles against sanity-io/swift-sanity', async () => {
    const content = await readFile(fileURLToPath(fixtureUrl), 'utf8')
    const schema = JSON.parse(content) as SchemaType
    const {code} = await swiftGenerator.generate({
      config: {
        generates: './Sources/App/SanityTypes.swift',
        schema: './schema.json',
      },
      schema,
      workDir: '/tmp',
    })

    const root = mkdtempSync(join(tmpdir(), 'sanity-swift-typegen-'))
    const sources = join(root, 'Sources', 'App')
    mkdirSync(sources, {recursive: true})
    writeFileSync(join(sources, 'SanityTypes.swift'), code, 'utf8')

    const pkgSwift = `// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "App",
    platforms: [.macOS(.v13), .iOS(.v16)],
    products: [
        .library(name: "App", targets: ["App"]),
    ],
    dependencies: [
        .package(url: "https://github.com/sanity-io/swift-sanity.git", branch: "main"),
    ],
    targets: [
        .target(
            name: "App",
            dependencies: [
                .product(name: "Sanity", package: "swift-sanity"),
            ],
            path: "Sources/App"
        ),
    ]
)
`
    writeFileSync(join(root, 'Package.swift'), pkgSwift, 'utf8')

    const result = spawnSync('swift', ['build'], {
      cwd: root,
      encoding: 'utf8',
      env: {...process.env},
    })

    if (result.status !== 0) {
      throw new Error(
        `swift build failed (status ${result.status}):\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
      )
    }
    expect(result.status).toBe(0)
  }, 120_000)
})

describe.skipIf(SWIFT_AVAILABLE)('swift build (skipped — toolchain not on PATH)', () => {
  test('swift not on PATH; toolchain integration test skipped', () => {
    expect(SWIFT_AVAILABLE).toBe(false)
  })
})
