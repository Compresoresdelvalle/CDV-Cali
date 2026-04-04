/**
 * apply-migrations.js
 * Applies all Phase 1 migrations to Supabase using the service_role key.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key node supabase/apply-migrations.js
 *
 * The service_role key is found in:
 *   Supabase Dashboard > Project Settings > API > service_role (secret)
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SUPABASE_URL = 'https://kbgwygnmhjeyiyyxosmb.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SERVICE_ROLE_KEY) {
  console.error('ERROR: Set SUPABASE_SERVICE_ROLE_KEY environment variable.')
  console.error('Example: SUPABASE_SERVICE_ROLE_KEY=eyJ... node supabase/apply-migrations.js')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
})

const migrations = [
  '20260404000001_fase1_01_extensions_enums_tables.sql',
  '20260404000002_fase1_02_functions_triggers.sql',
  '20260404000003_fase1_03_seed_data.sql',
  '20260404000004_fase1_04_rls_policies.sql',
]

async function runSQL(sql) {
  const { error } = await supabase.rpc('exec_sql', { sql_text: sql })
  if (error) throw error
}

async function applyMigrations() {
  console.log('Applying Phase 1 migrations to Supabase...\n')

  for (const filename of migrations) {
    const filepath = join(__dirname, 'migrations', filename)
    const sql = readFileSync(filepath, 'utf8')

    console.log(`Applying: ${filename}`)
    try {
      // Use the Supabase REST API pg endpoint directly
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/exec_sql`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SERVICE_ROLE_KEY,
            'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ sql_text: sql }),
        }
      )

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`HTTP ${response.status}: ${text}`)
      }

      console.log(`  OK: ${filename}\n`)
    } catch (err) {
      console.error(`  FAILED: ${filename}`)
      console.error(`  Error: ${err.message}\n`)
      process.exit(1)
    }
  }

  console.log('All migrations applied. Running verification...\n')

  // Verification queries
  const verifySQL = readFileSync(
    join(__dirname, 'migrations', '20260404000005_fase1_05_verify.sql'),
    'utf8'
  )
  console.log('Verification SQL written to:')
  console.log('  supabase/migrations/20260404000005_fase1_05_verify.sql')
  console.log('\nRun it in the Supabase Dashboard SQL Editor to confirm results.')
}

applyMigrations().catch(err => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
