// The numbered disc on each step's heading.
//
// A step is only a step if its order is legible before it is read, and three cards stacked
// down a page do not say that on their own. Not a `Badge`: this is a fixed-size disc that has
// to sit on the type baseline of a `CardTitle`, and a badge stretched to hold one digit is a
// pill, not a numeral.
//
// `aria-hidden`, because the heading beside it already reads as the step and a screen reader
// announcing "two, add bodo to your client" gains a number it has no use for.

export function McpStepNumber({ value }: { value: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
    >
      {value}
    </span>
  )
}
