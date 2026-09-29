import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function membership() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const member = await prisma.companyMember.findFirst({ where: { userId: session.user.id } });
  return member ? { session, member } : null;
}

const canEdit = (role: string) => ["OWNER", "ADMIN", "ACCOUNTANT"].includes(role);

async function ensureDefaults(companyId: string) {
  await prisma.financeCategory.createMany({
    data: [
      { companyId, name: "Služby", direction: "INCOME" },
      { companyId, name: "Zboží", direction: "INCOME" },
      { companyId, name: "Ostatní příjmy", direction: "INCOME" },
      { companyId, name: "Materiál", direction: "EXPENSE" },
      { companyId, name: "Nářadí a vybavení", direction: "EXPENSE" },
      { companyId, name: "Pohonné hmoty", direction: "EXPENSE" },
      { companyId, name: "Telefon a internet", direction: "EXPENSE" },
      { companyId, name: "Služby", direction: "EXPENSE" },
      { companyId, name: "Subdodávky", direction: "EXPENSE" },
      { companyId, name: "Bankovní poplatky", direction: "EXPENSE" },
      { companyId, name: "Ostatní výdaje", direction: "EXPENSE" },
    ],
    skipDuplicates: true,
  });
  const count = await prisma.financialAccount.count({ where: { companyId } });
  if (!count) {
    await prisma.financialAccount.create({
      data: { companyId, name: "Hlavní bankovní účet", type: "BANK" },
    });
  }
}

export async function GET() {
  const result = await membership();
  if (!result) return NextResponse.json({ error: "Nepřihlášený uživatel nebo chybějící firma." }, { status: 401 });
  await ensureDefaults(result.member.companyId);

  const [accounts, categories, incomes, expenses] = await Promise.all([
    prisma.financialAccount.findMany({ where: { companyId: result.member.companyId, isActive: true }, orderBy: { createdAt: "asc" } }),
    prisma.financeCategory.findMany({ where: { companyId: result.member.companyId, isActive: true }, orderBy: [{ direction: "asc" }, { name: "asc" }] }),
    prisma.income.findMany({ where: { companyId: result.member.companyId }, include: { account: true, category: true, invoice: { select: { id: true, number: true } }, customer: { select: { name: true } } }, orderBy: { date: "desc" }, take: 100 }),
    prisma.expense.findMany({ where: { companyId: result.member.companyId }, include: { account: true, category: true }, orderBy: { date: "desc" }, take: 100 }),
  ]);
  const totalIncome = incomes.reduce((s, x) => s + Number(x.amount), 0);
  const totalExpense = expenses.reduce((s, x) => s + Number(x.amount), 0);
  return NextResponse.json({ accounts, categories, incomes, expenses, summary: { totalIncome, totalExpense, balance: totalIncome - totalExpense } });
}

export async function POST(request: Request) {
  const result = await membership();
  if (!result) return NextResponse.json({ error: "Nepřihlášený uživatel nebo chybějící firma." }, { status: 401 });
  if (!canEdit(result.member.role)) return NextResponse.json({ error: "Nemáte oprávnění měnit finanční evidenci." }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Neplatná data." }, { status: 400 }); }
  const action = String(body.action ?? "");

  try {
    if (action === "account") {
      const name = String(body.name ?? "").trim();
      if (!name) throw new Error("Název účtu je povinný.");
      const type = body.type === "CASH" ? "CASH" : "BANK";
      const account = await prisma.financialAccount.create({ data: {
        companyId: result.member.companyId, name, type,
        accountNumber: String(body.accountNumber ?? "").trim() || null,
        bankCode: String(body.bankCode ?? "").trim() || null,
        openingBalance: Number(body.openingBalance ?? 0),
      }});
      return NextResponse.json({ account }, { status: 201 });
    }

    if (action === "category") {
      const name = String(body.name ?? "").trim();
      const direction = body.direction === "EXPENSE" ? "EXPENSE" : "INCOME";
      if (!name) throw new Error("Název kategorie je povinný.");
      const category = await prisma.financeCategory.create({ data: { companyId: result.member.companyId, name, direction, taxDeductible: body.taxDeductible !== false } });
      return NextResponse.json({ category }, { status: 201 });
    }

    if (action === "income" || action === "expense") {
      const amount = Number(body.amount);
      const accountId = String(body.accountId ?? "");
      const categoryId = String(body.categoryId ?? "");
      const date = new Date(String(body.date ?? new Date().toISOString()));
      const description = String(body.description ?? "").trim();
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Částka musí být větší než 0.");
      if (!accountId || !categoryId || !description) throw new Error("Účet, kategorie a popis jsou povinné.");
      if (Number.isNaN(date.getTime())) throw new Error("Neplatné datum.");

      const account = await prisma.financialAccount.findFirst({ where: { id: accountId, companyId: result.member.companyId, isActive: true } });
      const category = await prisma.financeCategory.findFirst({ where: { id: categoryId, companyId: result.member.companyId, direction: action === "income" ? "INCOME" : "EXPENSE", isActive: true } });
      if (!account || !category) throw new Error("Účet nebo kategorie nebyly nalezeny.");

      if (action === "income") {
        const invoiceId = String(body.invoiceId ?? "").trim() || null;
        const customerId = String(body.customerId ?? "").trim() || null;
        const income = await prisma.income.create({ data: {
          companyId: result.member.companyId, accountId, categoryId, invoiceId, customerId, date, amount,
          method: ["BANK_TRANSFER","CASH","CARD","OTHER"].includes(String(body.method)) ? String(body.method) as any : "BANK_TRANSFER",
          documentNumber: String(body.documentNumber ?? "").trim() || null, description, note: String(body.note ?? "").trim() || null,
        }});
        await prisma.auditLog.create({ data: { companyId: result.member.companyId, userId: result.member.userId, action: "CREATE", entity: "INCOME", entityId: income.id, details: amount.toFixed(2) } });
        return NextResponse.json({ income }, { status: 201 });
      }

      const expense = await prisma.expense.create({ data: {
        companyId: result.member.companyId, accountId, categoryId, date, amount,
        method: ["BANK_TRANSFER","CASH","CARD","OTHER"].includes(String(body.method)) ? String(body.method) as any : "BANK_TRANSFER",
        supplierName: String(body.supplierName ?? "").trim() || null,
        documentNumber: String(body.documentNumber ?? "").trim() || null, description,
        note: String(body.note ?? "").trim() || null, taxDeductible: body.taxDeductible !== false,
      }});
      await prisma.auditLog.create({ data: { companyId: result.member.companyId, userId: result.member.userId, action: "CREATE", entity: "EXPENSE", entityId: expense.id, details: amount.toFixed(2) } });
      return NextResponse.json({ expense }, { status: 201 });
    }

    throw new Error("Neznámá operace.");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Operaci se nepodařilo provést." }, { status: 400 });
  }
}
