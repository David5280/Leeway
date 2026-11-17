// Schema helpers shared by actions and domain code.

import { z } from 'zod'

/** Each field of S made optional, with any default removed. */
type PatchShape<S extends z.ZodRawShape> = {
  [K in keyof S]: z.ZodOptional<S[K] extends z.ZodDefault<infer Inner> ? Inner : S[K]>
}

/**
 * A schema for changing some fields of an object: every field is optional and
 * has no default, so fields left out stay as they are. Plain `.partial()` is
 * not enough here, because zod still fills in defaults for missing fields,
 * which would reset them.
 */
export function patchOf<S extends z.ZodRawShape>(schema: z.ZodObject<S>) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => {
      const inner = field instanceof z.ZodDefault ? field.unwrap() : field
      return [key, (inner as z.ZodType).optional()]
    }),
  )
  return z.object(shape) as unknown as z.ZodObject<PatchShape<S>>
}
