'use client'

// Event Settings > Library > Tags.
//
// Three kinds on one screen: Tracks, Tags and Rooms. That is BUILD_SPEC 5.0b ("Library >
// Tags is CRUD over the Tags table, and Tracks live alongside it") plus Rooms, which the
// audit does not mention and the product needs: the agenda schedules into rooms and until
// now nothing but `scripts/seed` could create one, so the agenda's room columns were fixed
// at whatever the seed happened to write.
//
// A `Tabs` strip rather than three stacked lists, because that is what the shared surfaces
// in this product use for a typed collection, and because the three lists are otherwise
// identical and would read as one long undifferentiated column.
//
// TRACK IS THE REVIEW CATEGORY (BUILD_SPEC 3), which is why the Tracks copy says so:
// routing sets it, reviewers are assigned by it, and an organizer renaming a track here is
// renaming a review queue.

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LookupList } from '@/features/settings/LookupList'
import type { LookupEntry } from '@/features/settings/lookups'

export type LibraryPanelProps = {
  eventId: string
  tracks: readonly LookupEntry[]
  tags: readonly LookupEntry[]
  rooms: readonly LookupEntry[]
  /**
   * Which tab to open on, from `?tab=` on the URL.
   *
   * It exists so a link can land on the list it means. The agenda's "Rooms & tracks"
   * control sends an organizer here, and until this was read they arrived on Tags, under a
   * heading reading "Tags", on a page whose nav entry reads "Tags", and had to notice two
   * further tabs to find the rooms the grid had just told them to create.
   *
   * The nav label, the heading and the URL segment all stay `Tags`: those are transcribed
   * off the real product (docs/parity/event-config.md), and it is bodo that put Tracks and
   * Rooms on the same page.
   */
  initialTab?: string
}

const TABS = ['tags', 'tracks', 'rooms']

export function LibraryPanel({ eventId, tracks, tags, rooms, initialTab }: LibraryPanelProps) {
  // Checked against the closed list rather than passed through: it comes off the URL.
  const openTab = TABS.find((known) => known === initialTab) ?? 'tags'

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <h2 className="font-heading text-lg font-semibold">Tags</h2>
        <p className="text-sm text-muted-foreground">Reusable labels across records.</p>
      </div>

      <Tabs defaultValue={openTab}>
        <TabsList>
          <TabsTrigger value="tags">Tags ({tags.length})</TabsTrigger>
          <TabsTrigger value="tracks">Tracks ({tracks.length})</TabsTrigger>
          <TabsTrigger value="rooms">Rooms ({rooms.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="tags" className="flex flex-col gap-3 pt-4">
          <p className="text-sm text-pretty text-muted-foreground">
            Free-form labels for grouping submissions. Unlike a track, a tag carries no reviewer
            assignment.
          </p>
          <LookupList eventId={eventId} kind="tag" entries={tags} />
        </TabsContent>

        <TabsContent value="tracks" className="flex flex-col gap-3 pt-4">
          <p className="text-sm text-pretty text-muted-foreground">
            A track is also the review category: form routing files a submission under one, and
            reviewers are assigned by it.
          </p>
          <LookupList eventId={eventId} kind="track" entries={tracks} />
        </TabsContent>

        <TabsContent value="rooms" className="flex flex-col gap-3 pt-4">
          <p className="text-sm text-pretty text-muted-foreground">
            The rooms the agenda schedules into. Two sessions in one room at one time is a conflict.
          </p>
          <LookupList eventId={eventId} kind="room" entries={rooms} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
