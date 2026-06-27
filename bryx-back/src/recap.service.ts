import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class RecapService {
    constructor(private readonly prisma: PrismaService) { }

    async getTodayRecap() {
        const invoices = await this.prisma.invoice.findMany({
            where: {
                status: {
                    not: 'CANCELLED',
                },
            },
            orderBy: {
                createdAt: 'asc',
            },
            include: {
                table: true,
                responsibleUser: true,
                createdByUser: true,
                validatedByUser: true,
                customer: true,
                items: true,
                payments: true,
            },
        });

        const tables = await this.prisma.table.findMany({
            where: {
                status: {
                    not: 'CANCELLED',
                },
            },
            include: {
                responsibleUser: true,
                invoices: {
                    include: {
                        items: true,
                    },
                },
            },
        });

        const users = await this.prisma.user.findMany({
            orderBy: {
                createdAt: 'asc',
            },
        });

        const invoiceTotals = invoices.map((invoice) => {
            const grossTotal = this.getInvoiceGrossTotal(invoice.items);
            const discount = this.getInvoiceDiscount(invoice, grossTotal);
            const total = Math.max(0, grossTotal - discount);
            const paid = invoice.cashPaid + invoice.cardPaid;
            const remaining = Math.max(0, total - paid);

            return {
                invoice,
                grossTotal,
                discount,
                total,
                paid,
                remaining,
            };
        });

        const totalFacture = invoiceTotals.reduce((sum, row) => {
            return sum + row.total;
        }, 0);

        const totalBrut = invoiceTotals.reduce((sum, row) => {
            return sum + row.grossTotal;
        }, 0);

        const totalRemise = invoiceTotals.reduce((sum, row) => {
            return sum + row.discount;
        }, 0);

        const totalEspeces = invoices.reduce((sum, invoice) => {
            return sum + invoice.cashPaid;
        }, 0);

        const totalCarte = invoices.reduce((sum, invoice) => {
            return sum + invoice.cardPaid;
        }, 0);

        const totalRegle = totalEspeces + totalCarte;

        const resteARegler = invoiceTotals.reduce((sum, row) => {
            return sum + row.remaining;
        }, 0);

        const totalPaiementDiffere = invoiceTotals.reduce((sum, row) => {
            if (!row.invoice.deferredPayment) return sum;
            return sum + row.remaining;
        }, 0);

        const byServer = users.map((user) => {
            const userRows = invoiceTotals.filter((row) => {
                return row.invoice.responsibleUserId === user.id;
            });

            const serverTotal = userRows.reduce((sum, row) => sum + row.total, 0);
            const serverCash = userRows.reduce(
                (sum, row) => sum + row.invoice.cashPaid,
                0,
            );
            const serverCard = userRows.reduce(
                (sum, row) => sum + row.invoice.cardPaid,
                0,
            );
            const serverPaid = serverCash + serverCard;
            const serverRemaining = userRows.reduce(
                (sum, row) => sum + row.remaining,
                0,
            );

            return {
                userId: user.id,
                name: user.name,
                role: user.role,
                total: serverTotal,
                cash: serverCash,
                card: serverCard,
                paid: serverPaid,
                remaining: serverRemaining,
                invoiceCount: userRows.length,
                openCount: userRows.filter((row) => row.invoice.status !== 'PAID')
                    .length,
                paidCount: userRows.filter((row) => row.invoice.status === 'PAID')
                    .length,
                deferredCount: userRows.filter((row) => row.invoice.deferredPayment)
                    .length,
            };
        });

        return {
            summary: {
                totalBrut,
                totalRemise,
                totalFacture,
                totalEspeces,
                totalCarte,
                totalRegle,
                resteARegler,
                totalPaiementDiffere,
                tableCount: tables.length,
                invoiceCount: invoices.length,
                openInvoiceCount: invoices.filter((invoice) => invoice.status !== 'PAID')
                    .length,
                paidInvoiceCount: invoices.filter((invoice) => invoice.status === 'PAID')
                    .length,
                deferredInvoiceCount: invoices.filter((invoice) => invoice.deferredPayment)
                    .length,
            },
            byServer,
            invoices: invoiceTotals.map((row) => ({
                id: row.invoice.id,
                name: row.invoice.name,
                status: row.invoice.status,
                table: row.invoice.table,
                responsibleUser: row.invoice.responsibleUser,
                createdByUser: row.invoice.createdByUser,
                customer: row.invoice.customer,
                grossTotal: row.grossTotal,
                discount: row.discount,
                total: row.total,
                cashPaid: row.invoice.cashPaid,
                cardPaid: row.invoice.cardPaid,
                paid: row.paid,
                remaining: row.remaining,
                deferredPayment: row.invoice.deferredPayment,
                items: row.invoice.items,
            })),
            tables,
        };
    }

    private getInvoiceGrossTotal(items: { quantity: number; unitPrice: number }[]) {
        return items.reduce((sum, item) => {
            return sum + item.quantity * item.unitPrice;
        }, 0);
    }

    private getInvoiceDiscount(
        invoice: {
            discountAmount: number;
            discountPercent: number;
        },
        grossTotal: number,
    ) {
        const amountDiscount = invoice.discountAmount || 0;
        const percentDiscount =
            invoice.discountPercent > 0
                ? grossTotal * (invoice.discountPercent / 100)
                : 0;

        return Math.min(grossTotal, amountDiscount + percentDiscount);
    }
}