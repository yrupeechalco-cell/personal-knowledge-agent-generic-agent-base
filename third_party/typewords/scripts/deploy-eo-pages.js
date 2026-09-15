/**
 * 通用 EO Pages 部署脚本
 * 用法: node scripts/deploy-eo-pages.js --dir <dist目录> --name <EO项目名>
 * 示例:
 *   node scripts/deploy-eo-pages.js --dir dist --name type-words-deploy
 *   node scripts/deploy-eo-pages.js -d dist -n vscode-web-deploy
 *
 * 环境变量: EO_PAGES_TOKEN（必填）
 */

const { spawn } = require('child_process')
const path = require('path')

const argv = process.argv.slice(2)
function getArg(name, short) {
  const i = argv.indexOf(name)
  const iShort = short != null ? argv.indexOf(short) : -1
  const idx = i >= 0 ? i : iShort
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1]
  return null
}

const dir = getArg('--dir', '-d') || 'dist'
const name = getArg('--name', '-n')

if (!name) {
  console.error('❌ 缺少 EO Pages 项目名，请使用 --name 或 -n 指定')
  process.exit(1)
}

const { EO_PAGES_TOKEN } = process.env
if (!EO_PAGES_TOKEN) {
  console.error('❌ 缺少必要的环境变量 EO_PAGES_TOKEN，请检查 GitHub Secrets 配置')
  process.exit(1)
}

const distPath = path.resolve(process.cwd(), dir)
const cmd = `edgeone pages deploy "${distPath}" -n ${name} -t ${EO_PAGES_TOKEN}`

const child = spawn(cmd, [], { shell: true, stdio: 'inherit' })
child.on('close', (code) => {
  process.exit(code ?? 0)
})

