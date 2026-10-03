import { createContext } from 'react'

/**
 * Id of the enclosing `ControlGroup`'s label, so chip groups inside it get an accessible name
 * without repeating the label.
 */
export const ControlGroupLabelContext = createContext<string | undefined>(undefined)
