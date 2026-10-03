/**
 * Types for the parts of Formio's full browser bundle (`formiojs/dist/formio.full.min.js`, the
 * build upstream loads from unpkg) that the dashboard uses. The package's own declarations are
 * mostly `any`; these describe the actual shapes, with form definitions kept as JSON.
 */
declare module 'formiojs/dist/formio.full.min.js' {
  /** Same as `Json` in `src/layout/json.ts` (ambient modules cannot import relative paths). */
  type Json = null | boolean | number | string | readonly Json[] | JsonObject
  interface JsonObject {
    readonly [key: string]: Json
  }

  /** A Formio form definition: `{ components: [...] }`, or `{}` for an empty form. */
  export type FormDefinition = JsonObject

  /** Component JSON inside a definition. */
  export interface ComponentSchema {
    [key: string]: Json | undefined
    key?: string
    type?: string
    components?: ComponentSchema[]
  }

  export interface ChangeEvent {
    readonly changed?: unknown
  }

  export interface Webform {
    /** The current definition. */
    readonly form: FormDefinition
    readonly submission: { readonly data: JsonObject }
    setForm(definition: FormDefinition): Promise<unknown>
    setSubmission(submission: { data: JsonObject }): Promise<unknown>
    checkValidity(data: JsonObject): boolean
    on(event: 'change', callback: (event: ChangeEvent) => void): void
    destroy(): void
  }

  export interface FormBuilder {
    readonly schema: FormDefinition
    setForm(definition: FormDefinition): Promise<unknown>
    on(event: 'updateComponent' | 'removeComponent', callback: () => void): void
    off(event: 'updateComponent' | 'removeComponent'): void
  }

  /** An edit form: tabs whose `components` hold the builder's settings components. */
  export interface EditForm {
    components: ComponentSchema[]
  }

  /** A Formio component class (e.g. `Formio.Components.components.select`). */
  export interface ComponentClass {
    new (...args: never[]): ComponentInstance
    schema(...extend: JsonObject[]): JsonObject
    editForm: () => EditForm
    readonly builderInfo: JsonObject
  }

  export interface ComponentInstance {
    setValue(value: unknown, flags?: unknown): unknown
    renderElement(value: unknown, index: unknown): string
  }

  export interface FormioStatic {
    createForm(element: HTMLElement, definition: FormDefinition, options?: JsonObject): Promise<Webform>
    builder(element: HTMLElement, definition: FormDefinition, options: JsonObject): Promise<FormBuilder>
    use(plugin: { components: Record<string, ComponentClass> }): void
    readonly Components: { readonly components: Record<string, ComponentClass | undefined> }
  }

  const Formio: FormioStatic
  export default Formio
}
