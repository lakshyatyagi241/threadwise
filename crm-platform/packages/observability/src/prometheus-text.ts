/**
 * A tiny Prometheus text-format (0.0.4) registry. The repo had no metrics stack when the event-loop monitor was added (only
 * Sentry), and the monitor needs about twenty series, so this avoids a dependency on a full client. Labels are fixed per series
 * at registration time by the caller: only low-cardinality values (service, instance, route template, queue name, status class)
 * may be passed. Never a tenant, contact, user or request id.
 */

export type Labels = Readonly<Record<string, string>>;

function escapeLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

export function formatLabels(labels: Labels, extra?: Labels): string {
  const all = { ...labels, ...extra };
  const keys = Object.keys(all);
  if (keys.length === 0) return '';
  return `{${keys.map((k) => `${k}="${escapeLabel(all[k] ?? '')}"`).join(',')}}`;
}

function formatValue(v: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (v === Infinity) return '+Inf';
  if (v === -Infinity) return '-Inf';
  return String(v);
}

function seriesKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join('\u0000');
}

export interface Family {
  name: string;
  help: string;
  type: 'gauge' | 'counter' | 'histogram';
  render(base: Labels): string[];
}

export class Gauge implements Family {
  readonly type = 'gauge' as const;
  private readonly values = new Map<string, { labels: Labels; value: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  set(value: number, labels: Labels = {}): void {
    if (!Number.isFinite(value)) return;
    this.values.set(seriesKey(labels), { labels, value });
  }
  render(base: Labels): string[] {
    return [...this.values.values()].map(
      (s) => `${this.name}${formatLabels(base, s.labels)} ${formatValue(s.value)}`,
    );
  }
}

export class Counter implements Family {
  readonly type = 'counter' as const;
  private readonly values = new Map<string, { labels: Labels; value: number }>();
  constructor(
    readonly name: string,
    readonly help: string,
  ) {}
  inc(by = 1, labels: Labels = {}): void {
    if (!Number.isFinite(by) || by < 0) return;
    const key = seriesKey(labels);
    const cur = this.values.get(key);
    if (cur) cur.value += by;
    else this.values.set(key, { labels, value: by });
  }
  render(base: Labels): string[] {
    return [...this.values.values()].map(
      (s) => `${this.name}${formatLabels(base, s.labels)} ${formatValue(s.value)}`,
    );
  }
}

export class Histogram implements Family {
  readonly type = 'histogram' as const;
  private readonly series = new Map<
    string,
    { labels: Labels; buckets: number[]; sum: number; count: number }
  >();
  constructor(
    readonly name: string,
    readonly help: string,
    private readonly bounds: readonly number[],
    /** Hard cap on distinct label sets. Past it, new sets fold into `overflow` so a bug cannot explode memory or cardinality. */
    private readonly maxSeries = 500,
    private readonly overflow: Labels = {},
  ) {}
  observe(value: number, labels: Labels = {}): void {
    if (!Number.isFinite(value) || value < 0) return;
    let key = seriesKey(labels);
    let useLabels = labels;
    if (!this.series.has(key) && this.series.size >= this.maxSeries) {
      useLabels = this.overflow;
      key = seriesKey(useLabels);
    }
    let s = this.series.get(key);
    if (!s) {
      s = {
        labels: useLabels,
        buckets: new Array<number>(this.bounds.length).fill(0),
        sum: 0,
        count: 0,
      };
      this.series.set(key, s);
    }
    for (let i = 0; i < this.bounds.length; i++) {
      if (value <= (this.bounds[i] as number)) s.buckets[i] = (s.buckets[i] as number) + 1;
    }
    s.sum += value;
    s.count += 1;
  }
  render(base: Labels): string[] {
    const lines: string[] = [];
    for (const s of this.series.values()) {
      this.bounds.forEach((b, i) => {
        lines.push(
          `${this.name}_bucket${formatLabels(base, { ...s.labels, le: String(b) })} ${s.buckets[i]}`,
        );
      });
      lines.push(
        `${this.name}_bucket${formatLabels(base, { ...s.labels, le: '+Inf' })} ${s.count}`,
      );
      lines.push(`${this.name}_sum${formatLabels(base, s.labels)} ${formatValue(s.sum)}`);
      lines.push(`${this.name}_count${formatLabels(base, s.labels)} ${s.count}`);
    }
    return lines;
  }
}

export class Registry {
  private readonly families: Family[] = [];
  /** Labels stamped on every series: the process identity (`service`, `instance`). */
  constructor(private readonly base: Labels) {}

  /** Adds a family that renders itself (cache-metrics.ts keeps its counts as plain numbers). */
  add(f: Family): void {
    this.families.push(f);
  }

  gauge(name: string, help: string): Gauge {
    const g = new Gauge(name, help);
    this.families.push(g);
    return g;
  }
  counter(name: string, help: string): Counter {
    const c = new Counter(name, help);
    this.families.push(c);
    return c;
  }
  histogram(
    name: string,
    help: string,
    bounds: readonly number[],
    overflow: Labels = {},
  ): Histogram {
    const h = new Histogram(name, help, bounds, 500, overflow);
    this.families.push(h);
    return h;
  }

  render(): string {
    const out: string[] = [];
    for (const f of this.families) {
      const lines = f.render(this.base);
      if (lines.length === 0) continue;
      out.push(
        `# HELP ${f.name} ${f.help.replace(/\n/g, ' ')}`,
        `# TYPE ${f.name} ${f.type}`,
        ...lines,
      );
    }
    return `${out.join('\n')}\n`;
  }
}
