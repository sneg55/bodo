// One import path for the submission-lifecycle chip and its inline editor.
//
// The two live in separate modules for two reasons. The chip must stay a server
// component: it appears in every row of every list, and making all of them client
// components to serve the handful that are editable is the payload mistake
// BUILD_SPEC section 6.3 exists to prevent. And the editor renders a chip, so a
// single file that exported both would be a dependency cycle, which `import/no-cycle`
// rejects.

export {
  StatusChip,
  type StatusChipProps,
  statusChipVariants,
  submissionStatusLabel,
} from '@/components/primitives/StatusChipBadge'
export {
  StatusChipEditor,
  type StatusChipEditorProps,
} from '@/components/primitives/StatusChipEditor'
