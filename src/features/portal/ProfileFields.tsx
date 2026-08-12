'use client'

// The two field groups inside the profile panels.
//
// Labels are verbatim from ref 18: `Biography`, `Salutation`, `First Name`, `Last Name`,
// `Honorific`, `Pronouns`, `Gender` in the General panel, and `LinkedIn URL`,
// `X (Twitter) URL`, `Facebook URL`, `Website` in My Links. The three-column grid and the
// horizontal rule under the Biography editor are as captured.
//
// The selects post through a hidden mirror, the same as the task checkbox: `Select` is a
// Base UI primitive, not a host `<select>`, so it contributes no FormData entry and the
// value would never reach the action without one.

import { useState } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import type { Choice } from '@/constants/vocabularies'
import { BiographyEditor } from '@/features/portal/BiographyEditor'
import {
  GENDER_OPTIONS,
  PROFILE_FIELD_NAMES,
  PRONOUN_OPTIONS,
  SELECT_PLACEHOLDER,
} from '@/features/portal/profile-form'

export type ProfileValues = {
  bio: string
  salutation: string
  firstName: string
  lastName: string
  honorific: string
  pronouns: string
  gender: string
  linkedin: string
  x: string
  facebook: string
  website: string
}

export function GeneralFields({ values }: { values: ProfileValues }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="bio-editor">Biography</Label>
        <div id="bio-editor">
          <BiographyEditor name={PROFILE_FIELD_NAMES.bio} initialHtml={values.bio} />
        </div>
      </div>

      <Separator />

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          name={PROFILE_FIELD_NAMES.salutation}
          label="Salutation"
          value={values.salutation}
        />
        <TextField
          name={PROFILE_FIELD_NAMES.firstName}
          label="First Name"
          value={values.firstName}
        />
        <TextField name={PROFILE_FIELD_NAMES.lastName} label="Last Name" value={values.lastName} />
        <TextField
          name={PROFILE_FIELD_NAMES.honorific}
          label="Honorific"
          value={values.honorific}
        />
        <SelectField
          name={PROFILE_FIELD_NAMES.pronouns}
          label="Pronouns"
          value={values.pronouns}
          options={PRONOUN_OPTIONS}
        />
        <SelectField
          name={PROFILE_FIELD_NAMES.gender}
          label="Gender"
          value={values.gender}
          options={GENDER_OPTIONS}
        />
      </div>
    </div>
  )
}

export function LinkFields({ values }: { values: ProfileValues }) {
  return (
    <div className="space-y-4">
      <TextField name={PROFILE_FIELD_NAMES.linkedin} label="LinkedIn URL" value={values.linkedin} />
      <TextField name={PROFILE_FIELD_NAMES.x} label="X (Twitter) URL" value={values.x} />
      <TextField name={PROFILE_FIELD_NAMES.facebook} label="Facebook URL" value={values.facebook} />
      <TextField name={PROFILE_FIELD_NAMES.website} label="Website" value={values.website} />
    </div>
  )
}

function TextField({ name, label, value }: { name: string; label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} defaultValue={value} />
    </div>
  )
}

function SelectField({
  name,
  label,
  value,
  options,
}: {
  name: string
  label: string
  value: string
  /** `value` is what Airtable stores, `label` is what the speaker reads. */
  options: readonly Choice[]
}) {
  const [selected, setSelected] = useState(value)

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${name}-trigger`}>{label}</Label>
      <Select
        // Base UI prints the raw value on the closed trigger without this, so a speaker who
        // picked an option saw whatever is stored for it rather than what they chose.
        items={Object.fromEntries(options.map((option) => [option.value, option.label]))}
        value={selected === '' ? null : selected}
        onValueChange={(next: string | null) => {
          setSelected(next ?? '')
        }}
      >
        {/* A default `SelectTrigger` is 32px tall. The band takes 4px each way, which clears
            the label 6px above it and the next grid row 16px below. The sibling `TextField`
            gets nothing on purpose: an `<input>` is a replaced element, so a `::after` on it
            never renders and the utility would be a lie. */}
        <SelectTrigger id={`${name}-trigger`} className="hit-area-y w-full">
          <SelectValue placeholder={SELECT_PLACEHOLDER} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input type="hidden" name={name} value={selected} readOnly />
    </div>
  )
}
