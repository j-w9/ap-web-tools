/**
 * In-page replacements for upstream's `alert()` and `confirm()`: same text, same choices (OK, or
 * OK and Cancel). Called from the imperative widget code, so they are plain DOM.
 */

function openDialog(text: string, withCancel: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div')
    backdrop.className = 'td-dialog-backdrop'
    const dialog = document.createElement('div')
    dialog.className = 'apwt-card td-dialog'
    dialog.setAttribute('role', withCancel ? 'alertdialog' : 'alert')
    const body = document.createElement('p')
    body.className = 'td-dialog__text'
    body.textContent = text
    const actions = document.createElement('div')
    actions.className = 'td-dialog__actions'

    const finish = (result: boolean): void => {
      backdrop.remove()
      resolve(result)
    }
    if (withCancel) {
      const cancel = document.createElement('button')
      cancel.type = 'button'
      cancel.className = 'apwt-btn'
      cancel.textContent = 'Cancel'
      cancel.addEventListener('click', () => finish(false))
      actions.append(cancel)
    }
    const ok = document.createElement('button')
    ok.type = 'button'
    ok.className = 'apwt-btn apwt-btn--primary'
    ok.textContent = 'OK'
    ok.addEventListener('click', () => finish(true))
    actions.append(ok)
    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') finish(false)
    })

    dialog.append(body, actions)
    backdrop.append(dialog)
    document.body.append(backdrop)
    ok.focus()
  })
}

/** Upstream `alert(text)`. */
export function showMessage(text: string): Promise<void> {
  return openDialog(text, false).then(() => undefined)
}

/** Upstream `confirm(text)`: resolves true for OK. */
export function confirmMessage(text: string): Promise<boolean> {
  return openDialog(text, true)
}
