import { supabase } from './supabase'
import type {
  Client,
  DailyLog,
  DailyLogFull,
  DailyLogItem,
  Estimate,
  EstimateLineItem,
  JobWithClient,
  PriceListItem,
} from './types'

// All reads run under the signed-in user (RLS = authenticated only).

export async function fetchActiveJobs(): Promise<JobWithClient[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*, client:clients(id, name)')
    .eq('status', 'active')
    .order('name')
  if (error) throw error
  return (data ?? []) as JobWithClient[]
}

export async function fetchJob(id: string): Promise<JobWithClient | null> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*, client:clients(id, name)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data as JobWithClient | null
}

export async function fetchPriceList(): Promise<PriceListItem[]> {
  const { data, error } = await supabase
    .from('price_list')
    .select('*')
    .order('sort_order')
  if (error) throw error
  return (data ?? []) as PriceListItem[]
}

export interface JobEstimateData {
  estimate: Estimate | null
  lineItems: EstimateLineItem[]
}

// The job's most recent non-lost estimate, with its line items. Phase 1 jobs
// usually have one estimate; we take the latest by date as the active baseline.
export async function fetchJobEstimate(jobId: string): Promise<JobEstimateData> {
  const { data: estimates, error } = await supabase
    .from('estimates')
    .select('*')
    .eq('job_id', jobId)
    .neq('status', 'lost')
    .order('estimate_date', { ascending: false })
  if (error) throw error

  const estimate = (estimates?.[0] ?? null) as Estimate | null
  if (!estimate) return { estimate: null, lineItems: [] }

  const { data: lines, error: lineErr } = await supabase
    .from('estimate_line_items')
    .select('*')
    .eq('estimate_id', estimate.id)
    .order('sort_order')
  if (lineErr) throw lineErr

  return { estimate, lineItems: (lines ?? []) as EstimateLineItem[] }
}

// All daily logs + their items for a job (used to compute built-to-date qty).
export async function fetchJobLoggedItems(
  jobId: string,
): Promise<{ logs: DailyLog[]; items: DailyLogItem[] }> {
  const { data: logs, error } = await supabase
    .from('daily_logs')
    .select('*')
    .eq('job_id', jobId)
  if (error) throw error
  const logList = (logs ?? []) as DailyLog[]
  if (logList.length === 0) return { logs: [], items: [] }

  const { data: items, error: itemErr } = await supabase
    .from('daily_log_items')
    .select('*')
    .in(
      'daily_log_id',
      logList.map((l) => l.id),
    )
  if (itemErr) throw itemErr

  return { logs: logList, items: (items ?? []) as DailyLogItem[] }
}

// ─────────────────────── Daily Log tab (Phase 1.5) ───────────────────────

export async function fetchClients(): Promise<Client[]> {
  const { data, error } = await supabase.from('clients').select('*').order('name')
  if (error) throw error
  return (data ?? []) as Client[]
}

// Every daily report with its job/client and line items, newest first.
export async function fetchAllDailyLogs(): Promise<DailyLogFull[]> {
  const { data, error } = await supabase
    .from('daily_logs')
    .select(
      '*, job:jobs(id, name, client:clients(id, name)), items:daily_log_items(*)',
    )
    .order('log_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as DailyLogFull[]
}

export type DailyLogPatch = Partial<
  Pick<
    DailyLog,
    'log_date' | 'submitted_by' | 'concrete_yards' | 'notes' | 'issues_delays' | 'ready_to_bill'
  >
>

export async function updateDailyLog(id: string, patch: DailyLogPatch): Promise<void> {
  const { error } = await supabase.from('daily_logs').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteDailyLog(id: string): Promise<void> {
  // daily_log_items cascade on delete (FK on delete cascade).
  const { error } = await supabase.from('daily_logs').delete().eq('id', id)
  if (error) throw error
}

export async function updateDailyLogItem(
  id: string,
  patch: { product_id?: string | null; quantity?: number },
): Promise<void> {
  const { error } = await supabase.from('daily_log_items').update(patch).eq('id', id)
  if (error) throw error
}

export async function addDailyLogItem(
  daily_log_id: string,
  product_id: string | null,
  quantity: number,
): Promise<void> {
  const { error } = await supabase
    .from('daily_log_items')
    .insert({ daily_log_id, product_id, quantity })
  if (error) throw error
}

export async function deleteDailyLogItem(id: string): Promise<void> {
  const { error } = await supabase.from('daily_log_items').delete().eq('id', id)
  if (error) throw error
}
