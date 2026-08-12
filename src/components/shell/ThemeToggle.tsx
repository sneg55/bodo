'use client'

import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/utils/cn'

const LABEL = 'Theme'

/**
 * The cross-fade between the two trigger icons.
 *
 * MARKED `!important` DELIBERATELY, and it is the only way this runs at all.
 * `ThemeProvider` passes `disableTransitionOnChange`, so next-themes injects
 * `*,*::before,*::after{transition:none!important}` into the head for one frame
 * either side of the class swap (see its `K()` helper in dist/index.js) and takes
 * it away a tick later. An ordinary transition here would therefore be suppressed
 * at precisely the moment it should play. Tailwind's utilities sit in a cascade
 * LAYER and that injected style does not; among `!important` declarations layered
 * ones outrank unlayered ones, so these three win that contest on their own,
 * without dropping `disableTransitionOnChange` and re-enabling colour transitions
 * on every button in the app at the same time.
 */
const ICON_MOTION =
  'transition-[opacity,filter,scale]! duration-300! ease-[cubic-bezier(0.2,0,0,1)]!'

/** `size-icon` draws 32px; the pressable area underneath it is 40px square. */
const HIT_AREA = 'hit-area'

const OPTIONS = [
  { value: 'light', label: 'Day', Icon: SunIcon },
  { value: 'dark', label: 'Night', Icon: MoonIcon },
  { value: 'system', label: 'System', Icon: MonitorIcon },
] as const

/**
 * A radio group and not three plain items: the menu picks ONE theme, so the
 * check belongs to the primitive, which reserves the gutter for it and reports
 * the choice to assistive tech instead of hiding it in the label string.
 *
 * The trigger icon is decided by CSS off the `.dark` class, not by React state,
 * and it shows the RESOLVED theme rather than the stored one (so `system` on a
 * dark machine shows the sun, same as an explicit Night). The usual `mounted`
 * flag exists because the stored theme is unknown during SSR, but that costs a
 * `useEffect` setting state on mount, which `react-hooks/set-state-in-effect`
 * fails the build on. Rendering both icons and letting the `dark:` variant pick
 * means the server and client markup are identical, with nothing to reconcile.
 * `theme` is only read inside the popup, which never renders until the menu is
 * opened, well after hydration.
 *
 * Both icons stay in the DOM and cross-fade rather than one being `hidden`: the
 * moon scales down to 0.25 and blurs out as the sun scales up out of a blur, so
 * the swap has an exit as well as an enter. Nothing unmounts, so neither half
 * needs a presence library.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label={LABEL} className={HIT_AREA}>
            {/* The moon is the in-flow icon and sizes the box; the sun overlays it. */}
            <span className="relative flex size-4 items-center justify-center">
              <SunIcon
                aria-hidden
                className={cn(
                  ICON_MOTION,
                  'absolute inset-0 scale-[0.25] opacity-0 blur-[4px] dark:scale-100 dark:opacity-100 dark:blur-[0px]',
                )}
              />
              <MoonIcon
                aria-hidden
                className={cn(
                  ICON_MOTION,
                  'scale-100 opacity-100 blur-[0px] dark:scale-[0.25] dark:opacity-0 dark:blur-[4px]',
                )}
              />
            </span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-36">
        <DropdownMenuRadioGroup
          value={theme ?? 'system'}
          onValueChange={(value) => {
            setTheme(value as string)
          }}
        >
          {OPTIONS.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value} closeOnClick>
              <Icon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
