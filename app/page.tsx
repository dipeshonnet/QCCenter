'use client';

import { useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Bell, CalendarDays, Check,
  CheckCircle2, ChevronRight, ClipboardCheck, FileBarChart, FileCheck2, Gauge,
  Home, Menu, MoreHorizontal, Search, Settings, ShieldCheck, Sparkles, Target,
  Upload, UserRound, X,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';

type Capa = {
  id: string;
  title: string;
  owner: string;
  priority: 'Critical' | 'High' | 'Medium';
  due: string;
  stage: string;
  note: string;
};

const navItems = [
  { label: 'Overview', icon: Home },
  { label: 'Scorecards', icon: ClipboardCheck },
  { label: 'Sampling', icon: Target },
  { label: 'Audit queue', icon: FileCheck2, count: 18 },
  { label: 'Analytics', icon: BarChart3 },
  { label: 'CAPA', icon: CheckCircle2, count: 5 },
  { label: 'Reports', icon: FileBarChart },
];

const qualityTrend = [
  { date: 'Aug 04', yield: 94.2, target: 95, audits: 38 },
  { date: 'Aug 08', yield: 95.7, target: 95, audits: 42 },
  { date: 'Aug 12', yield: 94.9, target: 95, audits: 36 },
  { date: 'Aug 16', yield: 96.4, target: 95, audits: 48 },
  { date: 'Aug 20', yield: 95.8, target: 95, audits: 51 },
  { date: 'Aug 24', yield: 97.1, target: 95, audits: 47 },
  { date: 'Aug 28', yield: 96.3, target: 95, audits: 55 },
  { date: 'Sep 01', yield: 96.8, target: 95, audits: 44 },
];

const defects = [
  { name: 'Accuracy', value: 31, color: '#155eef' },
  { name: 'Completeness', value: 24, color: '#2e90fa' },
  { name: 'Documentation', value: 19, color: '#53b1fd' },
  { name: 'Duplication', value: 12, color: '#84caff' },
];

const scorecards = [
  { name: 'Order Validation', score: 97.4, audits: 128, trend: '+1.8%', status: 'Healthy' },
  { name: 'Customer Retention', score: 94.8, audits: 96, trend: '+0.6%', status: 'Watch' },
  { name: 'Claims Processing', score: 92.6, audits: 84, trend: '-1.2%', status: 'At risk' },
];

const capaItems: Capa[] = [
  {
    id: 'CAPA-2418', title: 'Missing consent documentation', owner: 'Jane Smith',
    priority: 'Critical', due: 'Today', stage: 'Containment',
    note: 'Four reviewed audits lacked the required consent artifact. Immediate containment is active while the source workflow is traced.',
  },
  {
    id: 'CAPA-2413', title: 'SLA breaches above threshold', owner: 'Arjun Mehta',
    priority: 'High', due: 'Sep 03', stage: 'Root cause',
    note: 'Front-office response time exceeded the configured limit in three consecutive subgroups.',
  },
  {
    id: 'CAPA-2409', title: 'Incorrect account classification', owner: 'Maya Chen',
    priority: 'High', due: 'Sep 05', stage: 'Action plan',
    note: 'Classification guidance and the associated scorecard question are being revised together.',
  },
];

const chartConfig = {
  yield: { label: 'Quality yield', color: '#155eef' },
  target: { label: 'Target', color: '#98a2b3' },
} satisfies ChartConfig;

const navContent: Record<string, { eyebrow: string; title: string; description: string }> = {
  Scorecards: { eyebrow: 'Quality standards', title: 'Scorecards', description: 'Published, versioned quality definitions across every process.' },
  Sampling: { eyebrow: 'Representative selection', title: 'Build a sampling run', description: 'Upload a population, map its fields, and create an auditable sample.' },
  'Audit queue': { eyebrow: 'Review work', title: 'Audit queue', description: 'Prioritized cases ready for evaluation and reviewer sign-off.' },
  Analytics: { eyebrow: 'Six Sigma intelligence', title: 'Quality analytics', description: 'Control signals, capability measures, and recurring defect patterns.' },
  CAPA: { eyebrow: 'Corrective action', title: 'CAPA workspace', description: 'Move critical findings from containment through effectiveness review.' },
  Reports: { eyebrow: 'Governed exports', title: 'Reports', description: 'Create review-ready workbooks with the correct filters and audit trail.' },
};

function PriorityBadge({ priority }: { priority: Capa['priority'] }) {
  const styles = {
    Critical: 'border-red-200 bg-red-50 text-red-700',
    High: 'border-amber-200 bg-amber-50 text-amber-700',
    Medium: 'border-slate-200 bg-slate-50 text-slate-600',
  };
  return <Badge variant="outline" className={styles[priority]}>{priority}</Badge>;
}

function MetricCard({ label, value, helper, trend, tone = 'blue', icon: Icon }: {
  label: string; value: string; helper: string; trend: string;
  tone?: 'blue' | 'green' | 'amber' | 'red'; icon: typeof Gauge;
}) {
  const toneStyles = {
    blue: 'bg-blue-50 text-blue-700', green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700', red: 'bg-red-50 text-red-700',
  };
  return (
    <article className="metric-card">
      <div className="flex items-start justify-between gap-4">
        <div><p className="metric-label">{label}</p><p className="metric-value">{value}</p></div>
        <span className={`metric-icon ${toneStyles[tone]}`}><Icon aria-hidden="true" /></span>
      </div>
      <div className="mt-5 flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-emerald-700">{trend}</span>
        <span className="truncate text-slate-500">{helper}</span>
      </div>
    </article>
  );
}

function Overview({ openCapa }: { openCapa: (item: Capa) => void }) {
  return (
    <>
      <section className="hero-row">
        <div>
          <div className="eyebrow"><Sparkles /> Quality command center</div>
          <h1>Good morning, Jane.</h1>
          <p>Here’s what changed across your quality operation since yesterday.</p>
        </div>
        <Button className="h-10 rounded-xl bg-[#155eef] px-4 shadow-[0_7px_16px_rgba(21,94,239,.22)] hover:bg-[#004eeb]" onClick={() => openCapa(capaItems[0])}>
          Review critical action <ArrowRight data-icon="inline-end" />
        </Button>
      </section>

      <section className="metric-grid" aria-label="Key quality metrics">
        <MetricCard label="Overall yield" value="96.8%" helper="Target 95%" trend="↑ 1.4%" tone="green" icon={ShieldCheck} />
        <MetricCard label="Audit coverage" value="84.2%" helper="279 of 331" trend="↑ 6.1%" tone="blue" icon={Target} />
        <MetricCard label="Open CAPAs" value="5" helper="2 due this week" trend="↓ 3 closed" tone="amber" icon={CheckCircle2} />
        <MetricCard label="Critical findings" value="4" helper="Last 30 days" trend="↓ 2 vs prior" tone="red" icon={AlertTriangle} />
      </section>

      <section className="dashboard-grid">
        <article className="surface quality-chart-card">
          <div className="surface-heading">
            <div><p className="section-kicker">Process health</p><h2>Quality yield</h2></div>
            <div className="legend-row" aria-label="Chart legend">
              <span><i className="legend-dot bg-[#155eef]" /> Actual</span>
              <span><i className="legend-line" /> 95% target</span>
              <Button variant="ghost" size="icon-sm" aria-label="More chart options"><MoreHorizontal /></Button>
            </div>
          </div>
          <ChartContainer config={chartConfig} className="h-[275px] w-full aspect-auto px-2 pb-2" initialDimension={{ width: 720, height: 275 }}>
            <LineChart data={qualityTrend} margin={{ left: -12, right: 16, top: 16, bottom: 2 }}>
              <CartesianGrid vertical={false} stroke="#eef2f6" />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tickMargin={12} />
              <YAxis domain={[90, 100]} axisLine={false} tickLine={false} tickFormatter={(value) => `${value}%`} width={42} />
              <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
              <ReferenceLine y={95} stroke="#98a2b3" strokeDasharray="5 5" />
              <Line type="monotone" dataKey="yield" stroke="var(--color-yield)" strokeWidth={3} dot={{ r: 3, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ChartContainer>
          <div className="chart-summary">
            <div><CheckCircle2 /><span><b>Stable signal</b><small>No special-cause variation detected</small></span></div>
            <div><b>+1.9 pts</b><small>above the process target</small></div>
          </div>
        </article>

        <article className="surface scorecard-card">
          <div className="surface-heading">
            <div><p className="section-kicker">Coverage</p><h2>Process scorecards</h2></div>
            <Button variant="ghost" size="sm" className="text-[#155eef]">View all <ChevronRight /></Button>
          </div>
          <div className="scorecard-list">
            {scorecards.map((item) => (
              <div key={item.name} className="scorecard-row">
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`status-light ${item.status === 'Healthy' ? 'healthy' : item.status === 'Watch' ? 'watch' : 'risk'}`} />
                  <div className="min-w-0"><p className="truncate font-semibold text-slate-900">{item.name}</p><p className="text-xs text-slate-500">{item.audits} audits</p></div>
                </div>
                <div className="text-right"><p className="font-bold tabular-nums text-slate-900">{item.score}%</p><p className={`text-xs font-semibold ${item.trend.startsWith('-') ? 'text-red-600' : 'text-emerald-700'}`}>{item.trend}</p></div>
              </div>
            ))}
          </div>
          <div className="scorecard-footer"><span><i className="status-light healthy" /> Healthy</span><span><i className="status-light watch" /> Watch</span><span><i className="status-light risk" /> At risk</span></div>
        </article>

        <article className="surface defect-card">
          <div className="surface-heading">
            <div><p className="section-kicker">Pareto analysis</p><h2>Top defect drivers</h2></div>
            <span className="text-xs font-medium text-slate-500">86 findings</span>
          </div>
          <div className="defect-body">
            <div className="relative h-[190px] min-w-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={defects} layout="vertical" margin={{ left: 4, right: 18, top: 4, bottom: 4 }}>
                  <XAxis type="number" hide /><YAxis dataKey="name" type="category" width={98} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#475467' }} />
                  <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: 10, borderColor: '#e4e7ec', boxShadow: '0 12px 24px rgba(16,24,40,.08)' }} />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={18}>{defects.map((entry) => <Cell key={entry.name} fill={entry.color} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="defect-insight">
              <span className="insight-icon"><Activity /></span>
              <div><p className="font-semibold text-slate-900">Accuracy drives 36%</p><p className="mt-1 text-xs leading-5 text-slate-500">Most issues trace to one validation step in Order Processing.</p><Button variant="link" className="mt-2 h-auto p-0 text-[#155eef]">Explore defect pattern <ArrowRight /></Button></div>
            </div>
          </div>
        </article>

        <article className="surface capa-card">
          <div className="surface-heading">
            <div><p className="section-kicker">Action needed</p><h2>Urgent CAPA queue</h2></div>
            <Button variant="ghost" size="sm" className="text-[#155eef]">View all <ChevronRight /></Button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Issue</th><th>Priority</th><th>Due</th><th>Stage</th><th><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {capaItems.map((item) => (
                  <tr key={item.id} onClick={() => openCapa(item)} tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && openCapa(item)}>
                    <td><span className="issue-id">{item.id}</span><b>{item.title}</b></td><td><PriorityBadge priority={item.priority} /></td><td className={item.due === 'Today' ? 'font-semibold text-red-700' : ''}>{item.due}</td><td><span className="stage-pill">{item.stage}</span></td><td><ChevronRight className="size-4 text-slate-400" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </>
  );
}

function SecondaryView({ view }: { view: string }) {
  const copy = navContent[view];
  const Icon = navItems.find((item) => item.label === view)?.icon ?? Activity;
  return (
    <section className="secondary-view">
      <div className="hero-row">
        <div><div className="eyebrow"><Icon /> {copy.eyebrow}</div><h1>{copy.title}</h1><p>{copy.description}</p></div>
        <Button className="h-10 rounded-xl bg-[#155eef] px-4 hover:bg-[#004eeb]">{view === 'Sampling' ? <Upload /> : <Sparkles />}{view === 'Sampling' ? 'Upload population' : `Create ${view === 'CAPA' ? 'action' : 'new'}`}</Button>
      </div>
      <div className="surface empty-workspace"><span><Icon /></span><p className="section-kicker">{view}</p><h2>Your {view.toLowerCase()} workspace is ready</h2><p>This focused view carries over the governed workflow from the original Quality Command Center.</p><Button variant="outline" className="mt-5 rounded-xl">Open workflow <ArrowRight /></Button></div>
    </section>
  );
}

function CapaPanel({ item, onClose }: { item: Capa; onClose: () => void }) {
  const steps = ['Containment', 'Root cause', 'Action plan', 'Implementation', 'Review'];
  const current = steps.indexOf(item.stage);
  return (
    <div className="panel-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="detail-panel" role="dialog" aria-modal="true" aria-labelledby="capa-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="panel-head"><div><span className="issue-id">{item.id}</span><h2 id="capa-title">{item.title}</h2></div><Button variant="ghost" size="icon" aria-label="Close action details" onClick={onClose}><X /></Button></div>
        <div className="panel-content">
          <div className="flex items-center justify-between gap-3"><PriorityBadge priority={item.priority} /><span className="text-sm font-semibold text-red-700">Due {item.due.toLowerCase()}</span></div>
          <p className="panel-note">{item.note}</p>
          <div className="owner-card"><span><UserRound /></span><div><small>Action owner</small><b>{item.owner}</b></div><Button variant="ghost" size="sm">Change</Button></div>
          <div className="mt-8"><p className="section-kicker">Progress</p><div className="step-list">{steps.map((step, index) => <div key={step} className={index <= current ? 'complete' : ''}><span>{index < current ? <Check /> : index + 1}</span><div><b>{step}</b><small>{index < current ? 'Completed' : index === current ? 'In progress' : 'Upcoming'}</small></div></div>)}</div></div>
          <div className="mt-8"><div className="mb-3 flex items-center justify-between"><p className="section-kicker">Containment completion</p><b className="text-sm">72%</b></div><Progress value={72} className="[&_[data-slot=progress-track]]:h-2 [&_[data-slot=progress-indicator]]:bg-[#155eef]" /></div>
          <div className="panel-actions"><Button variant="outline" className="h-10 rounded-xl">Add evidence</Button><Button className="h-10 flex-1 rounded-xl bg-[#155eef] hover:bg-[#004eeb]">Continue action <ArrowRight /></Button></div>
        </div>
      </aside>
    </div>
  );
}

export default function HomePage() {
  const [activeView, setActiveView] = useState('Overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedCapa, setSelectedCapa] = useState<Capa | null>(null);
  const [query, setQuery] = useState('');
  const alertCount = useMemo(() => capaItems.filter((item) => item.priority === 'Critical').length, []);
  return (
    <div className="app-shell">
      {menuOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand-lockup"><span className="brand-mark"><ShieldCheck /></span><div><b>Northstar</b><small>Quality OS</small></div></div>
        <nav aria-label="Primary navigation"><p className="nav-label">Workspace</p>{navItems.map((item) => <button key={item.label} className={`nav-button ${activeView === item.label ? 'active' : ''}`} onClick={() => { setActiveView(item.label); setMenuOpen(false); }}><item.icon /><span>{item.label}</span>{item.count ? <i>{item.count}</i> : null}</button>)}</nav>
        <div className="sidebar-bottom"><button className="nav-button"><Settings /><span>Settings</span></button><div className="help-card"><span><ShieldCheck /></span><b>Controls are healthy</b><p>All policies synced 8 min ago.</p></div></div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <Button variant="ghost" size="icon" className="mobile-menu" aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Menu /></Button>
          <div className="context-selects">
            <label><span>Account</span><NativeSelect aria-label="Account" defaultValue="acme"><NativeSelectOption value="acme">Acme Healthcare</NativeSelectOption><NativeSelectOption value="all">All accounts</NativeSelectOption></NativeSelect></label>
            <label><span>Process</span><NativeSelect aria-label="Process" defaultValue="all"><NativeSelectOption value="all">All processes</NativeSelectOption><NativeSelectOption value="order">Order Validation</NativeSelectOption><NativeSelectOption value="retention">Customer Retention</NativeSelectOption></NativeSelect></label>
          </div>
          <div className="topbar-actions">
            <label className="search-box"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search cases, audits…" aria-label="Search" /><kbd>⌘ K</kbd></label>
            <Button variant="outline" className="date-control"><CalendarDays /> Last 30 days</Button>
            <Button variant="ghost" size="icon" className="notification-button" aria-label={`${alertCount} critical notification`}><Bell /><span>{alertCount}</span></Button>
            <div className="profile"><span>JS</span><div><b>Jane Smith</b><small>Administrator</small></div></div>
          </div>
        </header>
        <main className="main-content">
          {activeView === 'Overview' ? <Overview openCapa={setSelectedCapa} /> : <SecondaryView view={activeView} />}
          <footer><span>Data refreshed 8 minutes ago</span><span><i /> Live controls active</span></footer>
        </main>
      </div>
      {selectedCapa ? <CapaPanel item={selectedCapa} onClose={() => setSelectedCapa(null)} /> : null}
    </div>
  );
}
