"use client";

import * as React from "react";

type Account = { id: string; name: string; type: "BANK" | "CASH"; openingBalance: string | number };
type Category = { id: string; name: string; direction: "INCOME" | "EXPENSE"; taxDeductible: boolean };
type Entry = { id: string; date: string; amount: string | number; description: string; method: string; documentNumber?: string | null; supplierName?: string | null; account: Account; category: Category; invoice?: { number: string | null } | null };

const money = (v: number) => new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "CZK" }).format(v);
const date = (v: string) => new Intl.DateTimeFormat("cs-CZ").format(new Date(v));

export default function FinancePage() {
  const [data, setData] = React.useState<any>(null);
  const [tab, setTab] = React.useState<"income" | "expense">("income");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({ amount: "", date: new Date().toISOString().slice(0,10), description: "", documentNumber: "", supplierName: "", accountId: "", categoryId: "", method: "BANK_TRANSFER", taxDeductible: true });

  async function load() {
    setLoading(true);
    const r = await fetch("/api/finance");
    const j = await r.json();
    setData(j);
    if (j.accounts?.[0] && !form.accountId) setForm(f => ({ ...f, accountId: j.accounts[0].id }));
    const cats = (j.categories ?? []).filter((c: Category) => c.direction === tab);
    if (cats[0] && !form.categoryId) setForm(f => ({ ...f, categoryId: cats[0].id }));
    setLoading(false);
  }

  React.useEffect(() => { load(); }, []);
  React.useEffect(() => {
    const cat = (data?.categories ?? []).find((c: Category) => c.direction === tab);
    if (cat) setForm(f => ({ ...f, categoryId: cat.id }));
  }, [tab, data]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const r = await fetch("/api/finance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: tab, ...form, amount: Number(form.amount) }) });
    const j = await r.json();
    setSaving(false);
    if (!r.ok) { alert(j.error ?? "Chyba"); return; }
    setForm(f => ({ ...f, amount: "", description: "", documentNumber: "", supplierName: "" }));
    await load();
  }

  if (loading || !data) return <section className="page"><div className="page-header"><div><h1>Daňová evidence</h1><p>Načítám finanční evidenci…</p></div></div></section>;

  const income = Number(data.summary?.totalIncome ?? 0);
  const expense = Number(data.summary?.totalExpense ?? 0);

  return <section className="page">
    <div className="page-header">
      <div><h1>Daňová evidence</h1><p>Skutečné peněžní pohyby, ne jen vystavené faktury.</p></div>
      <div className="page-actions"><a className="button button-secondary" href="/uhrady">Úhrady faktur</a></div>
    </div>

    <div className="stats-grid">
      <div className="stat-card"><span>Příjmy</span><strong>{money(income)}</strong><small>evidované příjmy</small></div>
      <div className="stat-card"><span>Výdaje</span><strong>{money(expense)}</strong><small>evidované výdaje</small></div>
      <div className="stat-card"><span>Rozdíl</span><strong>{money(income - expense)}</strong><small>příjmy minus výdaje</small></div>
    </div>

    <div className="card" style={{ marginTop: 20 }}>
      <div className="card-header"><div><h2>Nový záznam</h2><p>Úhrada faktury zůstává samostatná. Tady evidujeme skutečný příjem nebo výdaj.</p></div>
        <div className="tabs"><button className={tab === "income" ? "tab active" : "tab"} onClick={() => setTab("income")}>Příjem</button><button className={tab === "expense" ? "tab active" : "tab"} onClick={() => setTab("expense")}>Výdaj</button></div>
      </div>
      <form className="form-grid" onSubmit={save}>
        <label>Datum<input type="date" value={form.date} onChange={e => setForm({...form, date:e.target.value})}/></label>
        <label>Částka<input type="number" min="0.01" step="0.01" value={form.amount} onChange={e => setForm({...form, amount:e.target.value})} required/></label>
        <label>Účet / pokladna<select value={form.accountId} onChange={e => setForm({...form, accountId:e.target.value})}>{data.accounts.map((a:Account)=><option key={a.id} value={a.id}>{a.name} · {a.type==="CASH"?"pokladna":"banka"}</option>)}</select></label>
        <label>Kategorie<select value={form.categoryId} onChange={e => setForm({...form, categoryId:e.target.value})}>{data.categories.filter((c:Category)=>c.direction===tab).map((c:Category)=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Způsob úhrady<select value={form.method} onChange={e => setForm({...form, method:e.target.value})}><option value="BANK_TRANSFER">Bankovní převod</option><option value="CASH">Hotově</option><option value="CARD">Kartou</option><option value="OTHER">Jiné</option></select></label>
        <label>Číslo dokladu<input value={form.documentNumber} onChange={e => setForm({...form, documentNumber:e.target.value})}/></label>
        {tab === "expense" && <label>Dodavatel<input value={form.supplierName} onChange={e => setForm({...form, supplierName:e.target.value})}/></label>}
        <label className="wide">Popis<input value={form.description} onChange={e => setForm({...form, description:e.target.value})} required/></label>
        {tab === "expense" && <label className="checkbox wide"><input type="checkbox" checked={form.taxDeductible} onChange={e => setForm({...form, taxDeductible:e.target.checked})}/> Daňově uznatelný výdaj</label>}
        <div className="wide"><button className="button button-primary" disabled={saving}>{saving ? "Ukládám…" : tab === "income" ? "Zapsat příjem" : "Zapsat výdaj"}</button></div>
      </form>
    </div>

    <div className="card" style={{ marginTop: 20 }}>
      <div className="card-header"><div><h2>{tab === "income" ? "Příjmy" : "Výdaje"}</h2><p>Posledních 100 záznamů.</p></div></div>
      <div className="table-wrap"><table><thead><tr><th>Datum</th><th>Doklad</th><th>Popis</th><th>Kategorie</th><th>Účet</th><th>Částka</th></tr></thead>
      <tbody>{(tab === "income" ? data.incomes : data.expenses).map((x:Entry)=><tr key={x.id}><td>{date(x.date)}</td><td>{x.documentNumber || x.invoice?.number || "—"}</td><td>{x.description}{x.supplierName ? <><br/><small>{x.supplierName}</small></> : null}</td><td>{x.category.name}</td><td>{x.account.name}</td><td><strong>{money(Number(x.amount))}</strong></td></tr>)}</tbody></table></div>
    </div>
  </section>;
}
