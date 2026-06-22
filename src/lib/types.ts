// TypeScript interfaces mirroring the Supabase schema (schema/01_schema.sql).

export interface Client {
  id: string
  name: string
  type: string | null
  contact_name: string | null
  email: string | null
  phone: string | null
  pricing_notes: string | null
  active: boolean
}

export interface PriceListItem {
  id: string
  name: string
  category: string | null
  unit: string
  default_rate: number
  active: boolean
  sort_order: number | null
}

export type JobStatus = 'active' | 'inactive' | 'archived'

export interface Job {
  id: string
  client_id: string | null
  name: string
  city: string | null
  job_number: string | null
  status: JobStatus
  date_added: string
  notes: string | null
}

export interface JobWithClient extends Job {
  client: Pick<Client, 'id' | 'name'> | null
}

export type EstimateStatus = 'draft' | 'sent' | 'approved' | 'lost'

export interface Estimate {
  id: string
  job_id: string
  estimate_number: string | null
  estimate_date: string
  status: EstimateStatus
  notes: string | null
}

export interface EstimateLineItem {
  id: string
  estimate_id: string
  product_id: string | null
  description: string | null
  unit: string | null
  quantity: number
  rate: number
  adjustment_note: string | null
  sort_order: number | null
  amount: number // generated: quantity * rate
}

export interface DailyLog {
  id: string
  job_id: string
  log_date: string
  submitted_by: string | null
  concrete_yards: number | null
  notes: string | null
  issues_delays: string | null
  ready_to_bill: boolean
  created_at?: string
}

export interface DailyLogItem {
  id: string
  daily_log_id: string
  product_id: string | null
  quantity: number
  sort_order?: number | null
}

// A daily log with its job/client and its line items, for the Daily Log tab.
export interface DailyLogFull extends DailyLog {
  job: {
    id: string
    name: string
    client: Pick<Client, 'id' | 'name'> | null
  } | null
  items: DailyLogItem[]
}
