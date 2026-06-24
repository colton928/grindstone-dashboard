import { supabase } from './supabase'
import type {
  Client,
  ClientPriceRule,
  DailyLog,
  DailyLogFull,
  DailyLogItem,
  Estimate,
  EstimateFull,
  EstimateLineItem,
  EstimateStatus,
  InvoiceFull,
  InvoiceStatus,
  JobStatus,
  JobWithClient,
  PriceListItem,
  ScheduleEvent,
  ScheduleEventFull,
  ScheduleKind,
  ScheduleStatus,
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

// Create a brand-new client inline (the "+ New client" option when bidding a job
// for a customer not yet in the system). New clients carry no price rules yet.
export async function createClient(name: string): Promise<Client> {
  const { data, error } = await supabase
    .from('clients')
    .insert({ name })
    .select('*')
    .single()
  if (error) throw error
  return data as Client
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

// Mark a daily report reviewed (clears the needs-review flag) or re-open it.
export async function setDailyLogReviewed(id: string, reviewed: boolean): Promise<void> {
  const { error } = await supabase
    .from('daily_logs')
    .update({ reviewed_at: reviewed ? new Date().toISOString() : null })
    .eq('id', id)
  if (error) throw error
}

// Count of reports that need review: have a note or issue and aren't reviewed.
// Powers the badge on the Logs tab.
export async function countDailyLogsNeedingReview(): Promise<number> {
  const { count, error } = await supabase
    .from('daily_logs')
    .select('id', { count: 'exact', head: true })
    .is('reviewed_at', null)
    .or('notes.not.is.null,issues_delays.not.is.null')
  if (error) throw error
  return count ?? 0
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

// ─────────────────────── Billing tab (Phase 2) ───────────────────────

export interface BillingRawData {
  jobs: JobWithClient[]
  logged: { job_id: string; product_id: string | null; quantity: number }[]
  billed: { job_id: string; product_id: string | null; quantity: number; rate: number; amount: number | null }[]
  estRates: { job_id: string; product_id: string | null; rate: number }[]
}

// One bulk pull powering the billing tracker (compute per-job client-side).
export async function fetchBillingData(): Promise<BillingRawData> {
  const [jobsRes, loggedRes, billedRes, estRes] = await Promise.all([
    supabase.from('jobs').select('*, client:clients(id, name)').order('name'),
    supabase.from('daily_log_items').select('product_id, quantity, daily_logs!inner(job_id)'),
    supabase
      .from('invoice_line_items')
      .select('product_id, quantity, rate, amount, invoices!inner(job_id)'),
    supabase
      .from('estimate_line_items')
      .select('product_id, rate, estimates!inner(job_id, status)'),
  ])
  for (const r of [jobsRes, loggedRes, billedRes, estRes]) if (r.error) throw r.error

  // PostgREST embeds the parent as a nested object; flatten to job_id.
  const logged = (loggedRes.data ?? []).map((r: any) => ({
    job_id: r.daily_logs.job_id as string,
    product_id: r.product_id,
    quantity: Number(r.quantity),
  }))
  const billed = (billedRes.data ?? []).map((r: any) => ({
    job_id: r.invoices.job_id as string,
    product_id: r.product_id,
    quantity: Number(r.quantity),
    rate: Number(r.rate),
    amount: r.amount != null ? Number(r.amount) : null,
  }))
  const estRates = (estRes.data ?? [])
    .filter((r: any) => r.estimates.status !== 'lost')
    .map((r: any) => ({
      job_id: r.estimates.job_id as string,
      product_id: r.product_id,
      rate: Number(r.rate),
    }))

  return { jobs: (jobsRes.data ?? []) as JobWithClient[], logged, billed, estRates }
}

// All invoices with job/client + line items (billing history + detail).
export async function fetchAllInvoices(): Promise<InvoiceFull[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*, job:jobs(id, name, client:clients(id, name)), lines:invoice_line_items(*)')
    .order('date_sent', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as InvoiceFull[]
}

export interface NewInvoiceLine {
  product_id: string | null
  description: string | null
  unit: string | null
  quantity: number
  rate: number
  sort_order: number
}

export async function createInvoice(
  invoice: {
    job_id: string
    bill_number: string | null
    date_sent: string | null
    status: InvoiceStatus
    notes: string | null
  },
  lines: NewInvoiceLine[],
): Promise<string> {
  const { data, error } = await supabase.from('invoices').insert(invoice).select('id').single()
  if (error) throw error
  const invoiceId = data.id as string
  if (lines.length) {
    const rows = lines.map((l) => ({
      invoice_id: invoiceId,
      product_id: l.product_id,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      rate: l.rate,
      // amount is a generated column (quantity * rate) — Postgres computes it, don't insert.
      sort_order: l.sort_order,
    }))
    const { error: lineErr } = await supabase.from('invoice_line_items').insert(rows)
    if (lineErr) throw lineErr
  }
  return invoiceId
}

export async function updateInvoiceStatus(id: string, status: InvoiceStatus): Promise<void> {
  const { error } = await supabase.from('invoices').update({ status }).eq('id', id)
  if (error) throw error
}

export async function updateInvoice(
  id: string,
  patch: { bill_number?: string | null; date_sent?: string | null; notes?: string | null; status?: InvoiceStatus },
): Promise<void> {
  const { error } = await supabase.from('invoices').update(patch).eq('id', id)
  if (error) throw error
}

// Replace all line items on an invoice (used when editing a draft): clear the
// old ones, then insert the edited set. amount stays a generated column.
export async function replaceInvoiceLines(
  invoiceId: string,
  lines: NewInvoiceLine[],
): Promise<void> {
  const { error: delErr } = await supabase
    .from('invoice_line_items')
    .delete()
    .eq('invoice_id', invoiceId)
  if (delErr) throw delErr
  if (lines.length) {
    const rows = lines.map((l) => ({
      invoice_id: invoiceId,
      product_id: l.product_id,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      rate: l.rate,
      sort_order: l.sort_order,
    }))
    const { error: lineErr } = await supabase.from('invoice_line_items').insert(rows)
    if (lineErr) throw lineErr
  }
}

export async function deleteInvoice(id: string): Promise<void> {
  // invoice_line_items cascade on delete.
  const { error } = await supabase.from('invoices').delete().eq('id', id)
  if (error) throw error
}

// ─────────────────────── Estimating tab (Phase 3) ───────────────────────

// All jobs (any status) — estimates/bids can be for jobs not yet active.
export async function fetchAllJobs(): Promise<JobWithClient[]> {
  const { data, error } = await supabase
    .from('jobs')
    .select('*, client:clients(id, name)')
    .order('name')
  if (error) throw error
  return (data ?? []) as JobWithClient[]
}

// Manually archive / restore a job (status: active | inactive | archived).
export async function updateJobStatus(id: string, status: JobStatus): Promise<void> {
  const { error } = await supabase.from('jobs').update({ status }).eq('id', id)
  if (error) throw error
}

// Create a brand-new job (estimates always start a fresh job — see Estimating).
export async function createJob(job: {
  name: string
  client_id: string | null
}): Promise<JobWithClient> {
  const { data, error } = await supabase
    .from('jobs')
    .insert({ name: job.name, client_id: job.client_id })
    .select('*, client:clients(id, name)')
    .single()
  if (error) throw error
  return data as JobWithClient
}

export async function fetchClientPriceRules(): Promise<ClientPriceRule[]> {
  const { data, error } = await supabase.from('client_price_rules').select('*')
  if (error) throw error
  return (data ?? []) as ClientPriceRule[]
}

// Every estimate with its job/client and line items, newest first.
export async function fetchAllEstimates(): Promise<EstimateFull[]> {
  const { data, error } = await supabase
    .from('estimates')
    .select(
      '*, job:jobs(id, name, client:clients(id, name)), lines:estimate_line_items(*)',
    )
    .order('estimate_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as EstimateFull[]
}

export interface NewEstimateLine {
  product_id: string | null
  description: string | null
  unit: string | null
  quantity: number
  rate: number
  adjustment_note: string | null
  sort_order: number
}

export async function createEstimate(
  estimate: {
    job_id: string
    estimate_number: string | null
    estimate_date: string | null
    status: EstimateStatus
    notes: string | null
  },
  lines: NewEstimateLine[],
): Promise<string> {
  const { data, error } = await supabase.from('estimates').insert(estimate).select('id').single()
  if (error) throw error
  const estimateId = data.id as string
  if (lines.length) {
    const rows = lines.map((l) => ({
      estimate_id: estimateId,
      product_id: l.product_id,
      description: l.description,
      unit: l.unit,
      quantity: l.quantity,
      rate: l.rate,
      // amount is a generated column (quantity * rate) — Postgres computes it, don't insert.
      adjustment_note: l.adjustment_note,
      sort_order: l.sort_order,
    }))
    const { error: lineErr } = await supabase.from('estimate_line_items').insert(rows)
    if (lineErr) throw lineErr
  }
  return estimateId
}

export async function updateEstimateStatus(id: string, status: EstimateStatus): Promise<void> {
  const { error } = await supabase.from('estimates').update({ status }).eq('id', id)
  if (error) throw error
}

export async function deleteEstimate(id: string): Promise<void> {
  // estimate_line_items cascade on delete.
  const { error } = await supabase.from('estimates').delete().eq('id', id)
  if (error) throw error
}

// ─────────────────────── Price Sheet tab (Phase 3) ───────────────────────

export async function addPriceItem(
  item: { name: string; category: string | null; unit: string; default_rate: number },
): Promise<PriceListItem> {
  const { data, error } = await supabase.from('price_list').insert(item).select('*').single()
  if (error) throw error
  return data as PriceListItem
}

export type PriceItemPatch = Partial<
  Pick<PriceListItem, 'name' | 'category' | 'unit' | 'default_rate' | 'active'>
>

export async function updatePriceItem(id: string, patch: PriceItemPatch): Promise<void> {
  const { error } = await supabase
    .from('price_list')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// ─────────────────────── Schedule tab (Phase 4) ───────────────────────

// Every schedule event with its job/client, soonest first.
export async function fetchScheduleEvents(): Promise<ScheduleEventFull[]> {
  const { data, error } = await supabase
    .from('schedule_events')
    .select('*, job:jobs(id, name, client:clients(id, name))')
    .order('event_date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: true })
  if (error) throw error
  return (data ?? []) as ScheduleEventFull[]
}

// Upcoming (today onward, not canceled) for the Home snapshot.
export async function fetchUpcomingSchedule(limit = 6): Promise<ScheduleEventFull[]> {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('schedule_events')
    .select('*, job:jobs(id, name, client:clients(id, name))')
    .neq('status', 'canceled')
    .or(`event_date.gte.${today},end_date.gte.${today}`)
    .order('event_date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: true })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as ScheduleEventFull[]
}

export interface NewScheduleEvent {
  job_id: string | null
  title: string
  kind: ScheduleKind
  event_date: string
  end_date: string | null
  start_time: string | null
  location: string | null
  notes: string | null
}

export async function createScheduleEvent(input: NewScheduleEvent): Promise<string> {
  const { data, error } = await supabase
    .from('schedule_events')
    .insert(input)
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

export type ScheduleEventPatch = Partial<
  Pick<
    ScheduleEvent,
    | 'job_id'
    | 'title'
    | 'kind'
    | 'event_date'
    | 'end_date'
    | 'start_time'
    | 'location'
    | 'notes'
    | 'status'
  >
>

export async function updateScheduleEvent(id: string, patch: ScheduleEventPatch): Promise<void> {
  const { error } = await supabase
    .from('schedule_events')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function setScheduleEventStatus(id: string, status: ScheduleStatus): Promise<void> {
  await updateScheduleEvent(id, { status })
}

export async function deleteScheduleEvent(id: string): Promise<void> {
  const { error } = await supabase.from('schedule_events').delete().eq('id', id)
  if (error) throw error
}
