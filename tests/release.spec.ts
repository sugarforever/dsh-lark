import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('release configuration', () => {
  it('declares the public repository and npm package metadata', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    expect(pkg).toMatchObject({
      name: '@sugarforever/dsh-lark',
      repository: {
        type: 'git',
        url: 'git+https://github.com/sugarforever/dsh-lark.git',
      },
      publishConfig: { access: 'public' },
    })
  })

  it('does not import the settingsNamespace helper missing from newer DSH releases', async () => {
    const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('settingsNamespace')
  })

  it('declares peer ranges that include the supported DSH 0.1.2 prerelease', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    const dshPeers = Object.entries(pkg.peerDependencies as Record<string, string>)
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))

    expect(dshPeers.length).toBeGreaterThan(0)
    for (const [, range] of dshPeers) expect(range).toContain('^0.1.2-rc.1')
  })

  it('ships an enabled, credential-reference based settings entry', async () => {
    const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
    const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
    expect(patch).toContain('disabled: false')
    expect(patch).toContain('appSecretRef: DSH_LARK_APP_SECRET')
    expect(patch).not.toContain('process.env.FEISHU_APP_SECRET')
    expect(readme).toContain('**Settings**')
  })

  it('declares a Harness web client that contributes the embedded settings section', async () => {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    expect(pkg.dsh.client).toEqual({
      platform: 'web',
      inject: expect.arrayContaining([
        '@deepseek-ai/dsh-client-runtime',
        '@deepseek-ai/dsh-client-locale',
        '@deepseek-ai/dsh-client-ui-settings',
      ]),
    })
    expect(pkg.exports['./client']).toBe('./client/client.js')
    expect(pkg.files).toContain('client/client.js')
  })

  it('publishes release tarballs through GitHub OIDC after all quality gates', async () => {
    const workflow = await readFile(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8')
    for (const required of [
      'release:', 'types: [published]', 'id-token: write', 'npm ci', 'npm test',
      'npm run typecheck', 'npm run build', 'npm pack', 'gh release upload', 'npm publish',
      'GITHUB_REF_NAME#v',
    ]) expect(workflow).toContain(required)
    expect(workflow).not.toContain('NPM_TOKEN')
    expect(workflow).toContain('npm publish "$GITHUB_WORKSPACE/${{ steps.pack.outputs.path }}"')
  })
})
