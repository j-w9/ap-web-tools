import type { GridStack, GridStackNode } from 'gridstack'
import type { StoredWidget, WidgetSpec } from '../layout/layout.js'
import type { WidgetHost } from './base.js'

/** Grid operations sub grids and the menu need from the dashboard (upstream globals). */
export interface GridHost extends WidgetHost {
  loadWidgets(grid: GridStack, widgets: readonly WidgetSpec[]): void
  getWidgets(grid: GridStack): StoredWidget[]
  clearGrid(grid: GridStack | null): void
  gridSetEdit(grid: GridStack | null, enabled: boolean): void
  widgetDropped(event: Event, previous: GridStackNode, dropped: GridStackNode): void
}

/** Shared border styling of the menu and sub grid frames. */
export function framedContent(): { widgetDiv: HTMLDivElement; sizeDiv: HTMLDivElement } {
  const widgetDiv = document.createElement('div')
  widgetDiv.style.border = '5px solid'
  widgetDiv.style.borderRadius = '10px'
  widgetDiv.style.borderColor = '#c8c8c8'
  widgetDiv.style.padding = '5px'
  widgetDiv.style.flex = '1'
  widgetDiv.style.overflow = 'hidden'
  widgetDiv.classList.add('grid-stack-item-content')

  const sizeDiv = document.createElement('div')
  sizeDiv.style.position = 'absolute'
  sizeDiv.style.top = '0'
  sizeDiv.style.left = '0'
  sizeDiv.style.bottom = '0'
  sizeDiv.style.right = '0'
  widgetDiv.append(sizeDiv)
  return { widgetDiv, sizeDiv }
}

export function fullSizeDiv(): HTMLDivElement {
  const div = document.createElement('div')
  div.style.border = 'none'
  div.style.width = '100%'
  div.style.height = '100%'
  div.style.overflow = 'hidden'
  return div
}
