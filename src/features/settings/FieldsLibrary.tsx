// Event Settings > Library > Fields, read only.
//
// Renders `src/constants/fields.ts` and nothing else. That registry is the single
// declaration of every session and participant field (BUILD_SPEC 3), and its own header
// comment names this screen as one of its four consumers: the DataTable preferences
// drawer, the two form-builder pickers, and here. A second list would be the divergence
// the registry exists to prevent.
//
// Read only because the fields are code-defined in this build. Sessionboard lets an admin
// add a custom field; bodo does not, because a field has to exist as a column or an
// answersJson key before anything can sort or filter on it. The note on the page says so
// rather than leaving an organizer hunting for an Add button.
//
// A plain `Table` rather than the shared DataTable primitive: nothing here sorts, filters,
// paginates or selects, and the primitive's toolbar would advertise all four.

import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ALL_REGISTRY_FIELDS, type FieldGroup, type RegistryField } from '@/constants/fields'
import { FIELD_TYPE_LABELS, type FieldType } from '@/types/forms'

/**
 * Group headings match the ones the preferences drawer shows
 * (DataTableColumnPicker), so the same registry reads the same way on both screens.
 */
const GROUP_LABELS: ReadonlyMap<FieldGroup, string> = new Map([
  ['session', 'SESSION DETAILS'],
  ['classification', 'CLASSIFICATION'],
  ['scheduling', 'SCHEDULING'],
  ['participant', 'PARTICIPANT'],
  ['reporting', 'REPORTING FIELDS'],
])

/** Registry order is meaningful, so groups come out in first-appearance order. */
function groupFields(
  fields: readonly RegistryField[],
): readonly { group: FieldGroup; fields: readonly RegistryField[] }[] {
  const groups = new Map<FieldGroup, RegistryField[]>()
  for (const field of fields) {
    const bucket = groups.get(field.group)
    if (bucket === undefined) groups.set(field.group, [field])
    else bucket.push(field)
  }
  return [...groups].map(([group, grouped]) => ({ group, fields: grouped }))
}

/** A Map, not object indexing: `security/detect-object-injection` warns on a computed
 * index into a plain object and that warning fails the build. */
const TYPE_LABELS: ReadonlyMap<FieldType, string> = new Map(
  Object.entries(FIELD_TYPE_LABELS).map(([type, label]) => [type as FieldType, label]),
)

function typeLabel(type: FieldType): string {
  return TYPE_LABELS.get(type) ?? type
}

export function FieldsLibrary() {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <h2 className="font-heading text-lg font-semibold">Fields</h2>
        <p className="text-sm text-pretty text-muted-foreground">
          Custom fields for contacts, sessions, and submissions.
        </p>
      </div>

      <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-pretty text-muted-foreground">
        These fields are defined in code, so this list is read only. Every form builder, every table
        column picker and every export reads the same registry, which is what keeps a field sortable
        and filterable rather than buried in a JSON blob.
      </p>

      {groupFields(ALL_REGISTRY_FIELDS).map((section) => (
        <section key={section.group} className="flex min-w-0 flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground">
            {GROUP_LABELS.get(section.group) ?? section.group.toUpperCase()}
          </h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Field</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Stored as</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {section.fields.map((field) => (
                  <TableRow key={field.key}>
                    <TableCell className="align-top">
                      <span className="font-medium">{field.label}</span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {field.key}
                      </span>
                    </TableCell>
                    <TableCell className="align-top">{typeLabel(field.type)}</TableCell>
                    <TableCell className="align-top">
                      <Badge variant={field.column ? 'secondary' : 'outline'}>
                        {field.column ? 'Column' : 'Answer'}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-md align-top text-sm text-muted-foreground">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {field.locked === true ? <Badge variant="outline">Locked</Badge> : null}
                        {field.defaultVisible ? <Badge variant="outline">Default</Badge> : null}
                        {field.maxLen === undefined ? null : (
                          <Badge variant="outline">Max {field.maxLen}</Badge>
                        )}
                      </span>
                      {field.help === undefined ? null : (
                        <span className="mt-1 block text-pretty">{field.help}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ))}
    </div>
  )
}
