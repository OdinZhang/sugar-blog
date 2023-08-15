/* eslint-disable no-console */
import glob from 'fast-glob'
import matter from 'gray-matter'
import fs, { writeFileSync } from 'fs'
import path from 'path'
import { SiteConfig } from 'vitepress'
import { Feed } from 'feed'
import {
  formatDate,
  normalizePath,
  getDefaultTitle,
  getFileBirthTime
} from './utils'
import { RSSOptions } from './type'

export async function getPagesData(srcDir: string, config: SiteConfig) {
  const files = glob.sync(`${srcDir}/**/*.md`, { ignore: ['node_modules'] })

  const { createMarkdownRenderer } = await import('vitepress')

  const mdRender = await createMarkdownRenderer(
    config.srcDir,
    config.markdown,
    config.site.base,
    config.logger
  )
  const pages = files.map((file) => {
    const fileContent = fs.readFileSync(file, 'utf-8')

    const { data: frontmatter, excerpt } = matter(fileContent, {
      excerpt: true
    })

    if (!frontmatter.title) {
      frontmatter.title = getDefaultTitle(fileContent)
    }

    if (!frontmatter.date) {
      frontmatter.date = getFileBirthTime(file)
    } else {
      frontmatter.date = formatDate(new Date(frontmatter.date))
    }

    // 获取摘要信息
    // TODO：支持自定义摘要
    frontmatter.description = frontmatter.description || excerpt

    // 获取封面图
    // TODO：用上封面图
    frontmatter.cover =
      frontmatter.cover ||
      fileContent.match(/[!]\[.*?\]\((https:\/\/.+)\)/)?.[1] ||
      ''

    const html = mdRender.render(fileContent)
    const url =
      config.site.base +
      normalizePath(path.relative(config.srcDir, file))
        .replace(/(^|\/)index\.md$/, '$1')
        .replace(/\.md$/, config.cleanUrls ? '' : '.html')
    return {
      filepath: file,
      fileContent,
      html,
      description: frontmatter.description,
      date: frontmatter.date,
      title: frontmatter.title,
      url,
      frontmatter
    }
  })

  return pages
}

export async function genFeed(config: SiteConfig, rssOptions: RSSOptions) {
  if (!rssOptions) return

  const srcDir =
    config.srcDir.replace(config.root, '').replace(/^\//, '') ||
    process.argv.slice(2)?.[1] ||
    '.'

  // 获取所有文章
  const posts = await getPagesData(srcDir, config)

  // TODO: filter
  // TODO：include layout home
  const { baseUrl, filename } = rssOptions

  const feed = new Feed(rssOptions)

  // 按日期排序
  posts.sort(
    (a, b) => +new Date(b.date as string) - +new Date(a.date as string)
  )

  for (const post of posts) {
    const { title, description, date, frontmatter, url, html } = post

    // 跳过未发布的文章
    if (frontmatter.publish === false) continue

    // TODO：全局默认作者
    // TODO: 作者链接
    // const authorLink = authorList.find((v) => v.nickname === author)?.url
    const { author } = frontmatter

    // 最后的文章链接
    const link = `${baseUrl}${url}`

    feed.addItem({
      title,
      id: link,
      link,
      description,
      content: html,
      author: [
        {
          name: author
          // link: authorLink
        }
      ],
      date: new Date(date)
    })
  }
  const RSSFilename = filename || 'feed.rss'
  const RSSFilepath = path.join(config.outDir, RSSFilename)
  writeFileSync(RSSFilepath, feed.rss2())
  console.log('🎉 RSS generated', RSSFilename)
  console.log('rss filepath:', RSSFilepath)
  console.log('rss url:', `${baseUrl}${config.site.base + RSSFilename}`)
  console.log()
}