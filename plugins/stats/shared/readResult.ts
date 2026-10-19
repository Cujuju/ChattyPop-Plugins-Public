/** One panel-read contract. Data belongs to this exact query and current visibility/calendar token. */
export interface AnalyticsRead<T> {
  data: T | null;
  building: boolean;
  done: number;
  total: number;
}
