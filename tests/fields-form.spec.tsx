/**
 * 描述符 → 表单渲染单测（jsdom + @testing-library/react）。
 */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfigFieldForm } from '../src/client/components/ModeSelect.js'
import type { ConfigField } from '../src/types.js'

afterEach(cleanup)

const t = (key: string): string => key

const fields: readonly ConfigField[] = [
  { type: 'text', content: '这是一段说明文字' },
  { type: 'input', key: 'why', title: '阻止原因', hint: '显示在 inhibit 列表', placeholder: '输入原因', default: 'dsh 任务执行中' },
  { type: 'textarea', key: 'note', title: '备注', rows: 4 },
  { type: 'boolean', key: 'fast', title: '快速', default: true },
  {
    type: 'select',
    key: 'level',
    title: '级别',
    default: 'a',
    options: [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
    ],
  },
  { type: 'number', key: 'timeout', title: '超时', default: 30, min: 1, max: 120 },
]

describe('ConfigFieldForm（描述符 → 表单渲染）', () => {
  it('text 字段渲染为说明段落（无交互控件）', () => {
    render(<ConfigFieldForm fields={[fields[0]!]} value={{}} onChange={() => {}} disabled={false} t={t} />)
    expect(screen.getByText('这是一段说明文字')).toBeTruthy()
    expect(document.querySelectorAll('input, textarea, select, button')).toHaveLength(0)
  })

  it('input 字段：占位符 + 默认值；输入触发 onChange', () => {
    const onChange = vi.fn()
    render(<ConfigFieldForm fields={[fields[1]!]} value={{}} onChange={onChange} disabled={false} t={t} />)
    const input = screen.getByPlaceholderText('输入原因') as HTMLInputElement
    expect(input.value).toBe('dsh 任务执行中') // 缺失回默认
    fireEvent.change(input, { target: { value: '自定义原因' } })
    expect(onChange).toHaveBeenCalledWith('why', '自定义原因')
  })

  it('input 字段：已有值优先于默认', () => {
    render(<ConfigFieldForm fields={[fields[1]!]} value={{ why: '已保存值' }} onChange={() => {}} disabled={false} t={t} />)
    expect((screen.getByPlaceholderText('输入原因') as HTMLInputElement).value).toBe('已保存值')
  })

  it('textarea 字段：rows 生效', () => {
    render(<ConfigFieldForm fields={[fields[2]!]} value={{}} onChange={() => {}} disabled={false} t={t} />)
    const area = document.querySelector('textarea') as HTMLTextAreaElement
    expect(area).toBeTruthy()
    expect(area.rows).toBe(4)
  })

  it('boolean 字段：开关按钮开/关 + 点击触发 onChange', () => {
    const onChange = vi.fn()
    render(<ConfigFieldForm fields={[fields[3]!]} value={{}} onChange={onChange} disabled={false} t={t} />)
    const btn = screen.getByRole('button') as HTMLButtonElement
    expect(btn.textContent).toBe('on') // 默认 true
    fireEvent.click(btn)
    expect(onChange).toHaveBeenCalledWith('fast', false)
  })

  it('boolean 字段：已有 false 显示关', () => {
    render(<ConfigFieldForm fields={[fields[3]!]} value={{ fast: false }} onChange={() => {}} disabled={false} t={t} />)
    expect(screen.getByRole('button').textContent).toBe('offShort')
  })

  it('select 字段：选项渲染 + 选择触发 onChange', () => {
    const onChange = vi.fn()
    render(<ConfigFieldForm fields={[fields[4]!]} value={{}} onChange={onChange} disabled={false} t={t} />)
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('a')
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['A', 'B'])
    fireEvent.change(select, { target: { value: 'b' } })
    expect(onChange).toHaveBeenCalledWith('level', 'b')
  })

  it('number 字段：type=number + min/max + 数值 onChange', () => {
    const onChange = vi.fn()
    render(<ConfigFieldForm fields={[fields[5]!]} value={{ timeout: 45 }} onChange={onChange} disabled={false} t={t} />)
    const input = screen.getByRole('spinbutton') as HTMLInputElement
    expect(input.type).toBe('number')
    expect(input.min).toBe('1')
    expect(input.max).toBe('120')
    expect(input.value).toBe('45')
    fireEvent.change(input, { target: { value: '60' } })
    expect(onChange).toHaveBeenCalledWith('timeout', 60)
  })

  it('disabled 时控件不可交互', () => {
    render(<ConfigFieldForm fields={[fields[1]!]} value={{}} onChange={() => {}} disabled={true} t={t} />)
    expect((screen.getByPlaceholderText('输入原因') as HTMLInputElement).disabled).toBe(true)
  })
})
