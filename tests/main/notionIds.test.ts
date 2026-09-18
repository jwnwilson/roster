import { describe, expect, test } from 'vitest'
import { notionPageIdFrom, notionPageUrl } from '@main/notion/ids'

const PAGE = '3dfc0977e9b1802c9e51ca0fc1acfc9c'
const VIEW = '7c8d70b5524044b3ae0809f90694c1e6'

describe('finding the page in a pasted Notion link', () => {
  test('reads the id out of a page URL', () => {
    expect(notionPageIdFrom(`https://www.notion.so/Ship-it-${PAGE}`)).toBe(PAGE)
  })

  test('ignores the view id that Copy link appends', () => {
    expect(
      notionPageIdFrom(`https://app.notion.com/p/Output-hello-${PAGE}?v=${VIEW}&source=copy_link`),
    ).toBe(PAGE)
  })

  test('prefers the page a database view was opened on', () => {
    expect(notionPageIdFrom(`https://www.notion.so/team/${VIEW}?v=${VIEW}&p=${PAGE}&pm=s`)).toBe(PAGE)
  })

  test('takes a bare id, dashed or not', () => {
    expect(notionPageIdFrom(PAGE)).toBe(PAGE)
    expect(notionPageIdFrom('3dfc0977-e9b1-802c-9e51-ca0fc1acfc9c')).toBe(PAGE)
  })

  test('refuses anything that carries no id', () => {
    expect(notionPageIdFrom('https://example.com/tasks/4')).toBeNull()
    expect(notionPageIdFrom('')).toBeNull()
    expect(notionPageIdFrom('   ')).toBeNull()
  })

  test('builds the link Roster stores from the id alone', () => {
    expect(notionPageUrl(PAGE)).toBe(`https://www.notion.so/${PAGE}`)
  })
})
