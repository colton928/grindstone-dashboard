import { supabase } from './supabase'
import type {
  DailyLog,
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
