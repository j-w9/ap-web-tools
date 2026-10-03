/**
 * Types for the Formio bundle upstream loads (`formiojs/dist/formio.full.min.js`), limited to what
 * the widgets and the widget editor use. The package's own typings are mostly `any`; this module
 * path has none, so it is typed here precisely.
 */
declare module 'formiojs/dist/formio.full.min.js' {
  type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject
  interface JsonObject {
    [key: string]: JsonValue
  }

  /** A Formio form definition (`{ components: [...] }`), kept as JSON. */
  export type FormDefinition = JsonObject

  export interface FormioSubmission {
    data: JsonObject
  }

  export interface FormioChangeEvent {
    changed?: unknown
  }

  /** A rendered form (`Formio.createForm`). */
  export interface FormioForm {
    /** The current definition. */
    form: FormDefinition
    submission: FormioSubmission
    setForm(definition: FormDefinition): Promise<unknown>
    setSubmission(submission: FormioSubmission): Promise<unknown>
    checkValidity(data: JsonObject): boolean
    on(event: 'change', callback: (event: FormioChangeEvent) => void): void
  }

  /** The drag-and-drop form builder (`Formio.builder`). */
  export interface FormioBuilder {
    schema: FormDefinition
    setForm(definition: FormDefinition | undefined): Promise<unknown>
    on(event: 'updateComponent' | 'removeComponent', callback: () => void): void
  }

  /** A node of a component's edit form (tabs, panels and fields), as `strip_component` walks it. */
  export interface EditFormNode {
    key?: string
    components?: EditFormNode[]
  }

  /** An instance of Formio's base input component, as the colour picker extends it. */
  export interface InputComponentInstance {
    setValue(value: unknown): unknown
    renderElement(value: unknown, index: number): string
  }

  /** A Formio component class. */
  export interface ComponentClass {
    editForm: () => EditFormNode
  }

  /** Formio's base input component class, extended by the colour picker. */
  export interface InputComponentClass extends ComponentClass {
    new (...args: unknown[]): InputComponentInstance
    schema(...extend: JsonObject[]): JsonObject
  }

  export interface FormioStatic {
    createForm(element: HTMLElement, definition: FormDefinition, options?: JsonObject): Promise<FormioForm>
    builder(element: HTMLElement, definition: FormDefinition, options: JsonObject): Promise<FormioBuilder>
    use(plugin: { components: Record<string, unknown> }): void
    Components: {
      components: Record<string, ComponentClass | undefined> & { input: InputComponentClass }
    }
  }

  const Formio: FormioStatic
  export default Formio
}
