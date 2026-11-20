export function plural<const K extends string>(key: K, forms: { one?: string; other: string }) {
  return {
    [key]: forms.other,
    [`${key}_one`]: forms.one ?? forms.other,
    [`${key}_other`]: forms.other,
  } as Record<K | `${K}_one` | `${K}_other`, string>;
}
