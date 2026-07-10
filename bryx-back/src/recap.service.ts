import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RealtimeService } from './realtime.service';

@Injectable()
export class RecapService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly realtime: RealtimeService,
    ) { }

    async getTodayRecap() {
        const { start, end } = this.getTodayBounds();

        const invoices = await this.prisma.invoice.findMany({
            where: {
                status: {
                    not: 'CANCELLED',
                },
                createdAt: {
                    gte: start,
                    lt: end,
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
                createdAt: {
                    gte: start,
                    lt: end,
                },
            },
            include: {
                responsibleUser: true,
                invoices: {
                    where: {
                        status: {
                            not: 'CANCELLED',
                        },
                        createdAt: {
                            gte: start,
                            lt: end,
                        },
                    },
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

        const medianTicket = this.getMedian(
            invoiceTotals.map((row) => row.total),
        );
        const ticketQuartiles = this.getQuartiles(
            invoiceTotals.map((row) => row.total),
        );

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
                medianTicket,
                firstQuartileTicket: ticketQuartiles.q1,
                thirdQuartileTicket: ticketQuartiles.q3,
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

    async closeToday(actorUserId: number) {
        const recap = await this.getTodayRecap();

        const openInvoices = await this.prisma.invoice.findMany({
            where: {
                status: {
                    notIn: ['PAID', 'CANCELLED'],
                },
            },
            select: {
                id: true,
                name: true,
                table: true,
            },
        });

        if (openInvoices.length) {
            throw new BadRequestException(
                `Impossible de clore la journee : ${openInvoices.length} facture(s) encore ouverte(s)`,
            );
        }

        const closedTables = await this.prisma.table.updateMany({
            where: {
                status: {
                    notIn: ['CLOSED', 'CANCELLED'],
                },
                invoices: {
                    none: {
                        status: {
                            notIn: ['PAID', 'CANCELLED'],
                        },
                    },
                },
            },
            data: {
                status: 'CLOSED',
            },
        });

        await this.prisma.activityLog.create({
            data: {
                action: 'CLOSE_DAY',
                actorUserId,
                details: `Cloture journee : ${recap.summary.invoiceCount} facture(s), ${closedTables.count} table(s), total ${recap.summary.totalFacture.toFixed(2)}`,
            },
        });

        this.realtime.broadcast('day.closed', {
            closedTables: closedTables.count,
            invoiceCount: recap.summary.invoiceCount,
            total: recap.summary.totalFacture,
        });

        return {
            closed: true,
            closedAt: new Date(),
            closedTables: closedTables.count,
            summary: recap.summary,
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

    private getMedian(values: number[]) {
        if (!values.length) return 0;

        const sorted = values.slice().sort((a, b) => a - b);
        return this.getMedianFromSorted(sorted);
    }

    private getQuartiles(values: number[]) {
        if (!values.length) {
            return { q1: 0, q3: 0 };
        }

        const sorted = values.slice().sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        const lowerHalf = sorted.slice(0, middle);
        const upperHalf =
            sorted.length % 2 === 0 ? sorted.slice(middle) : sorted.slice(middle + 1);

        return {
            q1: lowerHalf.length ? this.getMedianFromSorted(lowerHalf) : sorted[0],
            q3: upperHalf.length
                ? this.getMedianFromSorted(upperHalf)
                : sorted[sorted.length - 1],
        };
    }

    private getMedianFromSorted(sorted: number[]) {
        const middle = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 1) {
            return sorted[middle];
        }

        return (sorted[middle - 1] + sorted[middle]) / 2;
    }

    private getTodayBounds() {
        const start = new Date();
        start.setHours(0, 0, 0, 0);

        const end = new Date(start);
        end.setDate(end.getDate() + 1);

        return { start, end };
    }
}
