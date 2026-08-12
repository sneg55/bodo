import { createClient } from '@/services/airtable/client'
import { createScheduler } from '@/services/airtable/scheduler'

async function main(): Promise<void> {
  const client = createClient({
    baseId: 'appFake',
    token: 'patFake',
    scheduler: createScheduler({
      fetchImpl: () => Promise.resolve(new Response('{"records":[]}')),
    }),
  })
  const rows = await client.listAll('Events')
  process.stdout.write(`rows=${rows.length}\n`)
  const made = await client.createRecords('Events', [{ name: 'x' }])
  process.stdout.write(`made=${made.length}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`)
  process.exitCode = 1
})
