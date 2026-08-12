// Design-system enforcement: shadcn/ui is mandatory, hand-rolling is a lint error.
//
// This exists because the same failure happened in warpdrive and veodyn: an agent
// reads "use shadcn" in a doc, then writes `<button className="...">` or a
// `fixed inset-0` overlay anyway, because that is faster than checking what is
// installed. Documentation did not stop it. A failing lint does, and the
// lint-on-edit hook runs it on every write, so the feedback is immediate.
//
// Scope: these apply everywhere EXCEPT `src/components/ui/**`, which is the
// generated shadcn source and therefore the sanctioned implementation of exactly
// these primitives. That exemption is configured in eslint.config.mjs.
//
// If a rule below blocks something legitimate, the fix is to install the missing
// shadcn component (`npx shadcn@latest add <name>`), not to add a disable comment.
// See .claude/rules/ui-shadcn.md for the component map.

export const DESIGN_SYSTEM_RESTRICTED_SYNTAX = [
  // ── Interactive host elements that all have a primitive ────────────────────
  {
    selector: 'JSXOpeningElement[name.name="button"]',
    message:
      'Hand-rolled buttons are banned. Use <Button> from @/components/ui/button (variant="ghost" size="icon" covers icon buttons). If you need an unstyled trigger, use asChild on the primitive.',
  },
  {
    selector: 'JSXOpeningElement[name.name="input"]',
    message:
      'Hand-rolled inputs are banned. Use <Input>, <Checkbox>, <RadioGroup>, or <Switch> from @/components/ui/*. Checkboxes and radios are primitives too, not raw inputs.',
  },
  {
    selector: 'JSXOpeningElement[name.name="textarea"]',
    message: 'Use <Textarea> from @/components/ui/textarea.',
  },
  {
    selector: 'JSXOpeningElement[name.name="select"]',
    message:
      'Use <Select> from @/components/ui/select. For a searchable list use <Command>; for a multi-select use Popover + Command.',
  },
  {
    selector: 'JSXOpeningElement[name.name="dialog"]',
    message: 'Use <Dialog> from @/components/ui/dialog, or <Sheet> for a side drawer.',
  },
  {
    selector: 'JSXOpeningElement[name.name="table"]',
    message:
      'Use the <Table> primitives from @/components/ui/table. Admin lists go through the shared DataTable in @/components/primitives, which is built on them.',
  },

  // ── Hand-rolled overlays, menus, and popovers ─────────────────────────────
  {
    // The classic hand-rolled modal backdrop. Radix renders its own overlay, so
    // the sanctioned Dialog/Sheet never trips this.
    selector: 'Literal[value=/fixed inset-0/]',
    message:
      'Hand-rolled modal overlays are banned. Use <Dialog> (centered) or <Sheet> (drawer) from @/components/ui/*, which handle focus trap, scroll lock, and Escape for you.',
  },
  {
    selector: 'TemplateElement[value.raw=/fixed inset-0/]',
    message:
      'Hand-rolled modal overlays are banned. Use <Dialog> or <Sheet> from @/components/ui/*.',
  },
  {
    // Manual outside-click / Escape handling is the signature of a hand-rolled
    // menu or popover. Radix primitives already do this.
    selector:
      'CallExpression[callee.property.name="addEventListener"][arguments.0.value="mousedown"]',
    message:
      'Manual outside-click handling means a hand-rolled menu or popover. Use <DropdownMenu>, <Popover>, or <HoverCard> from @/components/ui/*, which own dismissal, focus, and ARIA.',
  },
  {
    selector: 'JSXAttribute[name.name="role"][value.value=/^tab(list)?$/]',
    message:
      'Hand-rolled tabs are banned. Use <Tabs> from @/components/ui/tabs; Radix supplies these roles at runtime.',
  },
  {
    selector: 'JSXAttribute[name.name="role"][value.value="dialog"]',
    message: 'Hand-rolled dialogs are banned. Use <Dialog> or <Sheet> from @/components/ui/*.',
  },
  {
    selector: 'JSXAttribute[name.name="role"][value.value=/^(menu|menuitem)$/]',
    message: 'Hand-rolled menus are banned. Use <DropdownMenu> or <ContextMenu>.',
  },

  // ── Native affordances that have a styled primitive ───────────────────────
  {
    // <iframe title> is a required accessible name, so it is exempt. `title` on a
    // Capitalized component is a prop, not a host attribute, and never matches.
    selector:
      'JSXOpeningElement[name.name=/^[a-z]/]:not([name.name="iframe"]) > JSXAttribute[name.name="title"]',
    message:
      'Native `title` tooltips are banned: they are unstyled, touch-hostile, and inconsistent with the parity target. Use <Tooltip> from @/components/ui/tooltip. (<iframe title> is exempt.)',
  },
  {
    selector: 'CallExpression[callee.name=/^(alert|confirm|prompt)$/]',
    message:
      'Browser dialogs are banned. Use <AlertDialog>/<Dialog> for confirmation and sonner `toast()` for notices.',
  },

  // ── Primitives that throw unless they are inside their own context ────────
  {
    // `DropdownMenuLabel` is Base UI's `Menu.GroupLabel`, which THROWS
    // "MenuGroupContext is missing" when it renders outside a Group
    // (node_modules/@base-ui/react/menu/group/MenuGroupContext.mjs). It is not a
    // styling problem: opening the menu drops the whole route to the error
    // boundary. Three menus shipped with this bug, including the density menu in
    // DataTableToolbar, which is on every data table in the app.
    //
    // Caught here rather than by a test because there is no DOM test environment
    // (vitest runs `environment: 'node'` for pure logic only), and the mistake is
    // purely structural, so a selector sees it exactly.
    selector:
      'JSXElement[openingElement.name.name="DropdownMenuContent"] > JSXElement[openingElement.name.name="DropdownMenuLabel"]',
    message:
      'DropdownMenuLabel is Menu.GroupLabel and throws outside a group, so this crashes the route when the menu opens. Wrap it and the items it labels in <DropdownMenuGroup>, or move it inside the <DropdownMenuRadioGroup> it labels.',
  },

  {
    // Base UI's `Select.Value` prints the RAW VALUE unless `Select.Root` is handed
    // an `items` map or the Value is given a render function. So a select whose
    // options carry a slug or a record id shows the label in the open list and the
    // stored value on the closed trigger, which is what an organizer actually reads.
    //
    // This shipped in EIGHT places before anyone reported it, including a speaker
    // picker that read `rec4zyLcalea4kNxh`, and two of them already carried a comment
    // from a previous person hitting it. That is the signature of a rule, not a
    // review note.
    //
    // Caught structurally rather than by a test: there is no DOM test environment
    // (vitest runs `environment: 'node'` for pure logic only), and the mistake is
    // exactly a missing attribute.
    //
    // The rule does not know whether a given select's labels differ from its values,
    // so it asks for `items` on every one. `DataTableFooter`'s page size is the one
    // place they are the same, and it passes the map anyway; carving out an exception
    // for the honest case is how the rule stops being enforced.
    selector:
      'JSXElement[openingElement.name.name="Select"]:not(:has(JSXAttribute[name.name="items"])) JSXElement[openingElement.name.name="SelectValue"][children.length=0]',
    message:
      'Base UI prints the raw value here, so the closed trigger will show the stored slug or record id rather than the label. Pass `items={{ value: label }}` to <Select>, or give <SelectValue> a render function.',
  },

  // ── Do not reach past shadcn to the primitives it wraps ───────────────────
  {
    selector: 'ImportDeclaration[source.value=/^@radix-ui\\//]',
    message:
      'Import the shadcn wrapper from @/components/ui/*, not @radix-ui directly. If the component you need is not installed, run `npx shadcn@latest add <name>` so the wrapper exists and carries our styling.',
  },
  {
    // Alternative component libraries: mixing them is how a codebase ends up
    // with three button styles.
    selector:
      'ImportDeclaration[source.value=/^(@mui|@chakra-ui|antd|react-bootstrap|@headlessui|@mantine|@nextui-org|@heroui)/]',
    message: 'This project uses shadcn/ui only. Do not introduce a second component library.',
  },
]

// React correctness. A separate export because it is not a design-system rule,
// but it is here for the same reason the block above is: the mistake it catches
// is invisible in review, cannot be asserted by a test in this repo, and both
// times it appeared it appeared by copying a neighbouring call site.
export const REACT_CORRECTNESS_RESTRICTED_SYNTAX = [
  {
    // `startTransition(() => { void (async () => { ... })() })`.
    //
    // The scope function returns the moment it has fired the promise, so React
    // sees a transition that finished synchronously: `isPending` goes true and
    // false again inside one tick, and every `disabled={pending}` derived from it
    // is decoration. The controls stay live for the whole round trip.
    //
    // That is a double-submit hole anywhere. In `features/crm/SpeakerTagEditor.tsx`
    // it LOST DATA, because `setSpeakerTags` replaces a speaker's whole tag
    // membership rather than diffing it: two chips clicked before the first
    // response re-rendered both computed their new set from the same stale prop,
    // so whichever landed second silently discarded the other.
    //
    // A lint rule rather than a test, deliberately, and the reasoning is the same
    // as the DropdownMenuLabel rule above. The property is about React scheduling,
    // and vitest here runs `environment: 'node'` with no renderer, so there is
    // nothing to assert against. Extracting the handler's logic does not help: a
    // behaviour-preserving extraction passes against the broken version too, which
    // is exactly what the review found. Meanwhile 52 of this repo's 54
    // `startTransition` call sites already use the correct form, so the two that
    // did not were copies, which is the "the doc said use it and it got
    // hand-rolled anyway" situation this file exists for.
    //
    // The selector is a `void` inside a NON-async scope, so it also catches
    // `startTransition(() => { void someAsyncThing() })`, which fails identically.
    // `startTransition(() => setState(x))` is untouched: a synchronous update is
    // what the sync form is for.
    selector:
      "CallExpression[callee.name='startTransition'] > ArrowFunctionExpression[async=false] UnaryExpression[operator='void']",
    message:
      'Voiding a promise inside startTransition ends the transition before the await, so `isPending` is false again in the same tick and every `disabled={pending}` becomes decorative (a double-submit hole, and a lost write wherever the handler computes from a prop). Write `startTransition(async () => { ... })` and await inside it, as the other call sites in this repo do.',
  },
]

// The server-action module boundary. Same reason as the two blocks above: the
// mistake is invisible in review, `next build` is silent on it, and no test in
// this repo can see it, because what breaks is the shape of the BUNDLE rather
// than anything the source can be asserted against.
export const SERVER_ACTION_RESTRICTED_SYNTAX = [
  {
    // `export type { X }` in a `'use server'` file, with no `from` clause.
    //
    // This took down every portal write on the deployed Worker. One line,
    // `export type { PortalActionResult }` at the foot of the imports in
    // `features/portal-config/actions.ts`, re-exporting a binding the file had
    // imported as `import { type PortalActionResult }`. The specifier survives
    // Next's `'use server'` transform into a runtime re-export, and because the
    // import it names was type-only there is no runtime binding behind it, so
    // the MODULE throws on evaluation:
    //
    //     ReferenceError: PortalActionResult is not defined
    //         at module evaluation (worker.js:106742:68)
    //
    // Every action in the file dies with it, not just the one nearest the type:
    // create, save, delete, duplicate, reorder and save-items all answered 500,
    // and Duplicate took the whole admin shell to the error page. It builds
    // clean and type-checks clean; the only place it is visible is a POST.
    //
    // Scoped precisely to the shape that breaks, and no wider. Two neighbours
    // are legitimate and stay legal: `export type Foo = { ... }`, a type ALIAS
    // declaration, which is erased (47 of them ship in this repo's action
    // files), and `export type { X } from './somewhere'`, the re-export WITH a
    // source, which is also erased (`features/dashboard/actions.ts` uses it and
    // its actions were verified working on the deployed Worker). It is only the
    // sourceless specifier list that leaves a dangling runtime name.
    //
    // The fix is never to add a disable comment. Import the type from the module
    // that declares it, at the call site that needs it. Nothing imported this one.
    // `:first-child` rather than `> ExpressionStatement`, for two reasons. A
    // leading child combinator inside `:has()` matches nothing in the esquery
    // build ESLint ships, verified against this file's own AST; and pinning the
    // directive to the first statement is what "this is a `'use server'` module"
    // actually means, so a `'use server'` string sitting somewhere in a client
    // file's body cannot drag the rule in with it.
    selector:
      'Program:has(ExpressionStatement:first-child > Literal[value="use server"]) ExportNamedDeclaration[exportKind="type"]:not([source]):has(ExportSpecifier)',
    message:
      "A sourceless `export type { X }` in a 'use server' file becomes a runtime re-export of a name that only existed as a type, so the whole module throws ReferenceError on evaluation and EVERY action in it answers 500. It builds and type-checks clean. Delete it and import the type from the module that declares it; `export type Foo = {...}` and `export type { X } from './mod'` are both fine.",
  },
]
