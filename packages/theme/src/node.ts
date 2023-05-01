/* eslint-disable prefer-rest-params */
import glob from 'fast-glob'
import matter from 'gray-matter'
import fs from 'fs'
import { execSync, spawn, spawnSync } from 'child_process'
import path from 'path'
import type { SiteConfig, UserConfig } from 'vitepress'
import { formatDate } from './utils/index'
import type { Theme } from './composables/config/index'

const checkKeys = ['themeConfig']

export function getThemeConfig(cfg?: Partial<Theme.BlogConfig>) {
  const srcDir = cfg?.srcDir || process.argv.slice(2)?.[1] || '.'
  const files = glob.sync(`${srcDir}/**/*.md`, { ignore: ['node_modules'] })

  const data = files
    .map((v) => {
      let route = v
        // 处理文件后缀名
        .replace('.md', '')

      // 去除 srcDir 处理目录名
      if (route.startsWith('./')) {
        route = route.replace(
          new RegExp(
            `^\\.\\/${path
              .join(srcDir, '/')
              .replace(new RegExp(`\\${path.sep}`, 'g'), '/')}`
          ),
          ''
        )
      } else {
        route = route.replace(
          new RegExp(
            `^${path
              .join(srcDir, '/')
              .replace(new RegExp(`\\${path.sep}`, 'g'), '/')}`
          ),
          ''
        )
      }

      const fileContent = fs.readFileSync(v, 'utf-8')

      // TODO: 支持JSON
      const meta: Partial<Theme.PageMeta> = {
        ...matter(fileContent).data
      }
      if (!meta.title) {
        meta.title = getDefaultTitle(fileContent)
      }
      if (!meta.date) {
        // getGitTimestamp(v).then((v) => {
        //   meta.date = formatDate(v)
        // })
        meta.date = getFileBirthTime(v)
      } else {
        // TODO: 开放配置，设置时区
        meta.date = formatDate(
          new Date(`${new Date(meta.date).toUTCString()}+8`)
        )
      }

      // 处理tags和categories,兼容历史文章
      meta.categories =
        typeof meta.categories === 'string'
          ? [meta.categories]
          : meta.categories
      meta.tags = typeof meta.tags === 'string' ? [meta.tags] : meta.tags
      meta.tag = [meta.tag || []]
        .flat()
        .concat([
          ...new Set([...(meta.categories || []), ...(meta.tags || [])])
        ])

      // 获取摘要信息
      const wordCount = 100
      meta.description =
        meta.description || getTextSummary(fileContent, wordCount)

      // 获取封面图
      meta.cover =
        meta.cover ||
        fileContent.match(/[!]\[.*?\]\((https:\/\/.+)\)/)?.[1] ||
        ''
      return {
        route: `/${route}`,
        meta
      }
    })
    .filter((v) => v.meta.layout !== 'home')

  const extraConfig: any = {}

  if (
    cfg?.search === 'pagefind' ||
    (cfg?.search instanceof Object && cfg.search.mode === 'pagefind')
  ) {
    checkKeys.push('vite')

    let resolveConfig: any
    extraConfig.vite = {
      plugins: [
        {
          name: '@sugarar/theme-plugin-pagefind',
          enforce: 'pre',
          configResolved(config: any) {
            if (resolveConfig) {
              return
            }
            resolveConfig = config

            const vitepressConfig: SiteConfig = config.vitepress
            if (!vitepressConfig) {
              return
            }

            // 添加 自定义 vitepress 的钩子
            const selfBuildEnd = vitepressConfig.buildEnd
            vitepressConfig.buildEnd = (siteConfig: any) => {
              // 调用自己的
              selfBuildEnd?.(siteConfig)
              // 调用pagefind
              const ignore: string[] = [
                // 侧边栏内容
                'div.aside',
                // 标题锚点
                'a.header-anchor'
              ]
              const { log } = console
              log()
              log('=== pagefind: https://pagefind.app/ ===')
              let command = `npx pagefind --source ${path.join(
                process.argv.slice(2)?.[1] || '.',
                '.vitepress/dist'
              )}`

              if (ignore.length) {
                command += ` --exclude-selectors "${ignore.join(', ')}"`
              }

              log(command)
              log()
              execSync(command, {
                stdio: 'inherit'
              })
            }
          },
          // 添加检索的内容标识
          transform(code: string, id: string) {
            if (id.endsWith('theme-default/Layout.vue')) {
              return code.replace(
                '<VPContent>',
                '<VPContent data-pagefind-body>'
              )
            }
            return code
          }
        }
      ]
    }
  }
  return {
    themeConfig: {
      blog: {
        pagesData: data as Theme.PageData[],
        ...cfg
      },
      ...(cfg?.blog !== false
        ? {
            sidebar: [
              {
                text: '',
                items: []
              }
            ]
          }
        : undefined)
    },
    ...extraConfig
  }
}

export function getDefaultTitle(content: string) {
  const title =
    clearMatterContent(content)
      .split('\n')
      ?.find((str) => {
        return str.startsWith('# ')
      })
      ?.slice(2)
      .replace(/[\s]/g, '') || ''
  return title
}

export function clearMatterContent(content: string) {
  let first___: unknown
  let second___: unknown

  const lines = content.split('\n').reduce<string[]>((pre, line) => {
    // 移除开头的空白行
    if (!line.trim() && pre.length === 0) {
      return pre
    }
    if (line.trim() === '---') {
      if (first___ === undefined) {
        first___ = pre.length
      } else if (second___ === undefined) {
        second___ = pre.length
      }
    }
    pre.push(line)
    return pre
  }, [])
  return (
    lines
      // 剔除---之间的内容
      .slice((second___ as number) || 0)
      .join('\n')
  )
}

export function getFileBirthTime(url: string) {
  let date = new Date()

  try {
    // 参考 vitepress 中的 getGitTimestamp 实现
    const infoStr = spawnSync('git', ['log', '-1', '--pretty="%ci"', url])
      .stdout?.toString()
      .replace(/["']/g, '')
      .trim()
    if (infoStr) {
      date = new Date(infoStr)
    }
  } catch (error) {
    return formatDate(date)
  }

  return formatDate(date)
}

export function getGitTimestamp(file: string) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['log', '-1', '--pretty="%ci"', file])
    let output = ''
    child.stdout.on('data', (d) => {
      output += String(d)
    })
    child.on('close', () => {
      resolve(+new Date(output))
    })
    child.on('error', reject)
  })
}

function getTextSummary(text: string, count = 100) {
  return (
    clearMatterContent(text)
      .match(/^# ([\s\S]+)/m)?.[1]
      // 除去标题
      ?.replace(/#/g, '')
      // 除去图片
      ?.replace(/!\[.*?\]\(.*?\)/g, '')
      // 除去链接
      ?.replace(/\[(.*?)\]\(.*?\)/g, '$1')
      // 除去加粗
      ?.replace(/\*\*(.*?)\*\*/g, '$1')
      ?.split('\n')
      ?.filter((v) => !!v)
      ?.slice(1)
      ?.join('\n')
      ?.replace(/>(.*)/, '')
      ?.slice(0, count)
  )
}

export function defineConfig(config: UserConfig<Theme.Config>) {
  // 兼容低版本主题配置
  // @ts-ignore
  if (config.themeConfig?.themeConfig) {
    config.extends = checkKeys.reduce((pre, key) => {
      // @ts-ignore
      pre[key] = config.themeConfig[key]
      // @ts-ignore
      delete config.themeConfig[key]
      return pre
    }, {})

    // 打印warn信息
    setTimeout(() => {
      console.warn('==↓ 主题配置方式过期，请尽快参照文档更新 ↓==')
      console.warn('https://theme.sugarat.top/config/global.html')
    }, 1200)
  }
  return config
}
